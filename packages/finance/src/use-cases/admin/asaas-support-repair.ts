import {
  createSubaccountAccessToken,
  deleteSubaccountAccessToken,
  getMyAccount,
  getSubaccount,
} from '@alusa/asaas';
import { inspectAsaasCredentials, prisma } from '@alusa/database';
import { normalizeCpfCnpjDigits } from '@alusa/lib';
import { FinanceIntegrationMode, type AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { credentialVault } from '../../foundation/credential-vault';
import {
  ensureWebhookReady,
  syncAsaasOperationalStatus,
} from '../../foundation/asaas-operational-guard';
import { withAdvisoryLock } from '../../foundation/advisory-lock';
import { enqueueAsaasSubaccountProvisioning } from '../../jobs/provision-asaas-subaccounts';
import { reconcileAsaasAccount } from '../asaas-account/reconcile-asaas-account';
import { getMasterAsaasApiKey } from '../asaas-account/asaas-env';
import { readWizardReadiness } from '../onboarding/wizard-service';
import { startFinancialOnboarding } from '../start-financial-onboarding';
import {
  getWebhookConfigDriftStatus,
  repairWebhookConfigDrift,
  type WebhookConfigDriftStatus,
} from '../../webhooks/webhook-config-drift.service';

function sanitizeActor(actor: { type: AuditActorType; id?: string | null }) {
  const id = actor.id?.trim();
  return id ? { type: actor.type, id } : { type: actor.type };
}

const PROVISION_JOB_TYPE = 'PROVISION_SUBACCOUNT' as const;
const WEBHOOK_JOB_TYPE = 'CONFIGURE_WEBHOOK' as const;
const RECOVERY_REQUIRED_PREFIX = 'RECOVERY_REQUIRED:';

function needsSubaccountKeyRecovery(params: {
  apiKeyEncrypted: string | null | undefined;
  apiKeyStatus: string;
}): boolean {
  if (!params.apiKeyEncrypted) return true;
  return params.apiKeyStatus !== 'CONNECTED';
}

function hasActionableWebhookDrift(status: WebhookConfigDriftStatus): boolean {
  const hasDrift = Object.entries(status.drift)
    .filter(([key]) => key !== 'missingEvents' && key !== 'extraEvents')
    .some(([, value]) => value === true);
  if (hasDrift) return true;
  return status.drift.missingEvents.length > 0 || status.drift.extraEvents.length > 0;
}

export type AsaasSupportRepairPhase =
  | 'NOT_WHITELABEL_BAAS'
  | 'NO_CONTA'
  | 'LOCAL_BOOTSTRAP_NEEDED'
  | 'WIZARD_INCOMPLETE'
  | 'PROVISION_JOB_IN_FLIGHT'
  | 'WEBHOOK_JOB_IN_FLIGHT'
  | 'NEED_MANUAL_SUBACCOUNT_LINK'
  | 'READY_TO_ENQUEUE_PROVISION'
  | 'API_KEY_OR_SUBACCOUNT_RECOVERY'
  | 'CREDENTIAL_DECRYPTION_FAILED'
  | 'WEBHOOK_DRIFT'
  | 'CONNECTED_HEALTHY';

export type AsaasSupportRecommendedAction =
  | 'NONE'
  | 'WAIT'
  | 'BOOTSTRAP_LOCAL'
  | 'ENQUEUE_PROVISION'
  | 'RECOVER_API_KEY'
  | 'REPAIR_WEBHOOK'
  | 'RECONCILE'
  | 'LINK_SUBACCOUNT'
  | 'COMPLETE_WIZARD';

export type AsaasSupportDiagnosis = {
  phase: AsaasSupportRepairPhase;
  financeIntegrationMode: FinanceIntegrationMode | null;
  hasFinanceProfile: boolean;
  hasAsaasAccountRow: boolean;
  effectiveAsaasAccountId: string | null;
  canCreateSubaccount: boolean;
  missingWizardFields: string[];
  provisionJob: { status: string; type: string } | null;
  webhookJob: { status: string; type: string } | null;
  lastCheckedAt: string | null;
  needsApiKeyRecovery: boolean;
  credentialHealth: 'CONNECTED' | 'MISSING' | 'DISCONNECTED' | 'DECRYPTION_FAILED';
  credentialSource: string;
  credentialFallbackUsed: boolean;
  integrationOperational: boolean;
  webhookDrift: boolean | null;
  recoveryStuckWithoutSubaccountId: boolean;
  recommendedAction: AsaasSupportRecommendedAction;
  hint: string;
};

export type AsaasSupportRepairExecuteAction =
  | 'BOOTSTRAP_LOCAL'
  | 'ENQUEUE_PROVISION'
  | 'REPAIR_WEBHOOK'
  | 'RECONCILE'
  | 'LINK_SUBACCOUNT'
  | 'RECOVER_API_KEY';

export type AsaasSupportRepairStep = { step: string; summary: string };

export type ExecuteAsaasSupportRepairOk = {
  ok: true;
  steps: AsaasSupportRepairStep[];
  finalDiagnosis: AsaasSupportDiagnosis;
};

export type ExecuteAsaasSupportRepairFail = {
  ok: false;
  summary: string;
  errorCode: string;
  finalDiagnosis?: AsaasSupportDiagnosis;
};

export async function diagnoseAsaasSupportRepair(contaId: string): Promise<AsaasSupportDiagnosis> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      id: true,
      financeIntegrationMode: true,
      cpfCnpj: true,
      financeProfile: {
        select: {
          id: true,
          asaasAccountId: true,
          asaasAccount: {
            select: {
              id: true,
              asaasAccountId: true,
              apiKeyEncrypted: true,
              apiKeyStatus: true,
              webhookStatus: true,
      provisionLastError: true,
              lastHealthCheckAt: true,
              lastWebhookCheckAt: true,
              lastApiKeyCheckAt: true,
              lastAsaasSyncAt: true,
            },
          },
        },
      },
    },
  });

  if (!conta) {
    return {
      phase: 'NO_CONTA',
      financeIntegrationMode: null,
      hasFinanceProfile: false,
      hasAsaasAccountRow: false,
      effectiveAsaasAccountId: null,
      canCreateSubaccount: false,
      missingWizardFields: [],
      provisionJob: null,
      webhookJob: null,
      lastCheckedAt: null,
      needsApiKeyRecovery: false,
      credentialHealth: 'MISSING',
      credentialSource: 'none',
      credentialFallbackUsed: false,
      integrationOperational: false,
      webhookDrift: null,
      recoveryStuckWithoutSubaccountId: false,
      recommendedAction: 'NONE',
      hint: 'Conta não encontrada.',
    };
  }

  if (conta.financeIntegrationMode !== FinanceIntegrationMode.WHITELABEL_BAAS) {
    return {
      phase: 'NOT_WHITELABEL_BAAS',
      financeIntegrationMode: conta.financeIntegrationMode,
      hasFinanceProfile: Boolean(conta.financeProfile),
      hasAsaasAccountRow: Boolean(conta.financeProfile?.asaasAccount),
      effectiveAsaasAccountId:
        conta.financeProfile?.asaasAccount?.asaasAccountId ??
        conta.financeProfile?.asaasAccountId ??
        null,
      canCreateSubaccount: false,
      missingWizardFields: [],
      provisionJob: null,
      webhookJob: null,
      lastCheckedAt: null,
      needsApiKeyRecovery: false,
      credentialHealth: 'MISSING',
      credentialSource: 'none',
      credentialFallbackUsed: false,
      integrationOperational: false,
      webhookDrift: null,
      recoveryStuckWithoutSubaccountId: false,
      recommendedAction: 'NONE',
      hint: 'O reparo guiado aplica-se apenas a escolas em modo white-label BaaS.',
    };
  }

  const profile = conta.financeProfile;
  const asaasRow = profile?.asaasAccount ?? null;
  const effectiveAsaasAccountId = asaasRow?.asaasAccountId ?? profile?.asaasAccountId ?? null;
  const lastCheckedAt = [
    asaasRow?.lastHealthCheckAt,
    asaasRow?.lastWebhookCheckAt,
    asaasRow?.lastApiKeyCheckAt,
    asaasRow?.lastAsaasSyncAt,
  ]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?.toISOString() ?? null;

  const readiness = await readWizardReadiness(contaId);
  const canCreateSubaccount = readiness?.canCreateSubaccount ?? false;
  const missingWizardFields = readiness?.missingFields ?? [];

  const [provisionJob, webhookJob] = await Promise.all([
    prisma.asaasIntegrationJob.findFirst({
      where: {
        contaId,
        type: PROVISION_JOB_TYPE,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      select: { status: true, type: true },
    }),
    prisma.asaasIntegrationJob.findFirst({
      where: {
        contaId,
        type: WEBHOOK_JOB_TYPE,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      select: { status: true, type: true },
    }),
  ]);

  const credentialInspection = await inspectAsaasCredentials(contaId);
  const integrationOperational = credentialInspection.health === 'CONNECTED';

  const needsApiKeyRecovery = asaasRow
    ? needsSubaccountKeyRecovery({
        apiKeyEncrypted: asaasRow.apiKeyEncrypted,
        apiKeyStatus: asaasRow.apiKeyStatus,
      }) || credentialInspection.health !== 'CONNECTED'
    : true;

  const recoveryStuckWithoutSubaccountId =
    Boolean(asaasRow?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX)) &&
    !effectiveAsaasAccountId;

  let webhookDrift: boolean | null = null;
  if (integrationOperational) {
    const driftStatus = await getWebhookConfigDriftStatus(contaId).catch(() => null);
    webhookDrift = driftStatus ? hasActionableWebhookDrift(driftStatus) : null;
  }

  // Um job antigo não pode sobrescrever um estado já confirmado como ativo.
  // Se houver divergência real, o job continua relevante para permitir o reparo.
  const effectiveWebhookJob = webhookJob && (
    asaasRow?.webhookStatus !== 'ACTIVE' || webhookDrift === true
  )
    ? webhookJob
    : null;

  let phase: AsaasSupportRepairPhase = 'CONNECTED_HEALTHY';
  let recommendedAction: AsaasSupportRecommendedAction = 'RECONCILE';
  let hint = 'Integração operacional. Reconciliar alinha estado local com o Asaas.';

  if (!profile || !asaasRow) {
    phase = 'LOCAL_BOOTSTRAP_NEEDED';
    recommendedAction = 'BOOTSTRAP_LOCAL';
    hint =
      'Criar perfil financeiro e registro local Asaas (placeholder) antes de provisionar ou vincular.';
  } else if (!canCreateSubaccount) {
    phase = 'WIZARD_INCOMPLETE';
    recommendedAction = 'COMPLETE_WIZARD';
    hint =
      missingWizardFields.length > 0
        ? `Preencha os dados do assistente financeiro: ${missingWizardFields.join(', ')}.`
        : 'Complete os dados do assistente financeiro antes de provisionar a subconta.';
  } else if (provisionJob) {
    phase = 'PROVISION_JOB_IN_FLIGHT';
    recommendedAction = 'WAIT';
    hint =
      'Job de provisionamento de subconta em andamento ou na fila. Aguarde o worker ou execute o processador de jobs.';
  } else if (integrationOperational && effectiveWebhookJob) {
    phase = 'WEBHOOK_JOB_IN_FLIGHT';
    recommendedAction = webhookDrift === true ? 'REPAIR_WEBHOOK' : 'WAIT';
    hint =
      webhookDrift === true
        ? 'Há job de webhook na fila, mas já é possível reparar a configuração manualmente com a chave atual.'
        : 'Configuração de webhook na fila. Aguarde o job ou reparar quando a chave estiver estável.';
  } else if (recoveryStuckWithoutSubaccountId) {
    phase = 'NEED_MANUAL_SUBACCOUNT_LINK';
    recommendedAction = 'LINK_SUBACCOUNT';
    hint =
      'O provisionamento exige intervenção manual: vincule o ID da subconta criada no Asaas (com conferência de CPF/CNPJ).';
  } else if (credentialInspection.health === 'DECRYPTION_FAILED') {
    phase = 'CREDENTIAL_DECRYPTION_FAILED';
    recommendedAction = 'RECOVER_API_KEY';
    hint =
      'A credencial está registrada, mas não pode ser lida com segurança. Verifique a configuração de criptografia ou recupere o acesso pela integração.';
  } else if (
    effectiveAsaasAccountId &&
    (needsApiKeyRecovery ||
      (!integrationOperational &&
        Boolean(asaasRow?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX))))
  ) {
    phase = 'API_KEY_OR_SUBACCOUNT_RECOVERY';
    recommendedAction = 'RECOVER_API_KEY';
    hint =
      'A Alusa não consegue autenticar nesta subconta. Recupere o acesso pela integração para validar e armazenar uma nova credencial com segurança.';
  } else if (!effectiveAsaasAccountId) {
    phase = 'READY_TO_ENQUEUE_PROVISION';
    recommendedAction = 'ENQUEUE_PROVISION';
    hint = 'Enfileirar criação da subconta no Asaas (processamento assíncrono).';
  } else if (webhookDrift === true) {
    phase = 'WEBHOOK_DRIFT';
    recommendedAction = 'REPAIR_WEBHOOK';
    hint = 'Ajustar URL, eventos ou token do webhook na subconta.';
  } else {
    phase = 'CONNECTED_HEALTHY';
    recommendedAction = 'RECONCILE';
    hint = 'Sincronizar status de onboarding e dados com o Asaas.';
  }

  return {
    phase,
    financeIntegrationMode: conta.financeIntegrationMode,
    hasFinanceProfile: Boolean(profile),
    hasAsaasAccountRow: Boolean(asaasRow),
    effectiveAsaasAccountId,
    canCreateSubaccount,
    missingWizardFields,
    provisionJob,
    webhookJob: effectiveWebhookJob,
    lastCheckedAt,
    needsApiKeyRecovery,
    credentialHealth: credentialInspection.health,
    credentialSource: credentialInspection.source,
    credentialFallbackUsed: credentialInspection.fallbackUsed,
    integrationOperational,
    webhookDrift,
    recoveryStuckWithoutSubaccountId,
    recommendedAction,
    hint,
  };
}

function parseProviderDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
}

function remoteAccountMatchesExpected(params: {
  remoteAccount: { id?: string | null; cpfCnpj?: string | null };
  expectedAsaasAccountId: string;
  contaCpfCnpj?: string | null;
}) {
  if (params.remoteAccount.id?.trim()) {
    return params.remoteAccount.id.trim() === params.expectedAsaasAccountId;
  }

  const expectedDocument = normalizeDigits(params.contaCpfCnpj);
  const remoteDocument = normalizeDigits(params.remoteAccount.cpfCnpj);
  return Boolean(expectedDocument && remoteDocument && expectedDocument === remoteDocument);
}

function recoveryFailure(error: unknown, context: 'master' | 'subaccount' = 'master'): { summary: string; errorCode: string } {
  if (error instanceof Error && error.name === 'MissingAsaasApiKeyError') {
    return {
      summary: 'A credencial principal do Asaas não está configurada neste ambiente.',
      errorCode: 'MASTER_KEY_MISSING',
    };
  }

  const failure = classifyAsaasOperationalError(error, context);

  if (failure.status === 403) {
    return {
      summary:
        'O Asaas bloqueou a recuperação. Habilite temporariamente o gerenciamento de chaves de subcontas no Asaas e confirme se o IP de saída da Alusa está autorizado na whitelist.',
      errorCode: 'ASAAS_KEY_MANAGEMENT_NOT_AUTHORIZED',
    };
  }

  if (failure.status === 401 || failure.category === 'invalid_master_credentials') {
    return {
      summary: context === 'master'
        ? 'A credencial principal do Asaas não está autorizada para esta operação.'
        : 'O Asaas não aceitou a nova credencial criada para a subconta.',
      errorCode: context === 'master' ? 'MASTER_CREDENTIAL_INVALID' : 'SUBACCOUNT_CREDENTIAL_INVALID',
    };
  }

  if (failure.status === 404 || failure.category === 'subaccount_not_found') {
    return {
      summary: 'A subconta não foi encontrada no Asaas. Verifique o vínculo antes de tentar novamente.',
      errorCode: 'SUBACCOUNT_NOT_FOUND',
    };
  }

  return {
    summary: 'O Asaas não permitiu recuperar a credencial agora. Tente novamente em instantes.',
    errorCode: 'ASAAS_KEY_RECOVERY_FAILED',
  };
}

async function revokeCreatedAccessToken(accountId: string, accessTokenId: string) {
  if (!accessTokenId) return;

  try {
    await deleteSubaccountAccessToken({
      apiKey: getMasterAsaasApiKey(),
      accountId,
      accessTokenId,
    });
  } catch {
    // O token criado não é persistido quando a validação ou o armazenamento falha.
    // A falha fica restrita ao retorno da operação para não expor detalhes sensíveis.
  }
}

async function recoverSubaccountApiKeyCore(input: {
  contaId: string;
  reason: string;
  actor: { type: AuditActorType; id?: string | null };
}): Promise<ExecuteAsaasSupportRepairOk | ExecuteAsaasSupportRepairFail> {
  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { id: true, cpfCnpj: true, financeIntegrationMode: true },
  });

  if (!conta) return { ok: false, summary: 'Conta não encontrada.', errorCode: 'NO_CONTA' };
  if (conta.financeIntegrationMode !== FinanceIntegrationMode.WHITELABEL_BAAS) {
    return {
      ok: false,
      summary: 'A recuperação de credencial só se aplica a escolas em modo white-label BaaS.',
      errorCode: 'NOT_WHITELABEL_BAAS',
    };
  }

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: {
      id: true,
      asaasAccountId: true,
      asaasAccount: {
        select: {
          id: true,
          asaasAccountId: true,
          apiKeyId: true,
        },
      },
    },
  });
  const asaasAccount = profile?.asaasAccount;
  const asaasAccountId = asaasAccount?.asaasAccountId ?? profile?.asaasAccountId ?? null;

  if (!profile || !asaasAccount) {
    return { ok: false, summary: 'Registro financeiro local não encontrado.', errorCode: 'NO_ASAAS_ACCOUNT' };
  }
  if (!asaasAccountId) {
    return { ok: false, summary: 'A subconta Asaas ainda não está vinculada.', errorCode: 'NO_SUBACCOUNT_ID' };
  }

  let accessToken: Awaited<ReturnType<typeof createSubaccountAccessToken>>;
  try {
    accessToken = await createSubaccountAccessToken({
      apiKey: getMasterAsaasApiKey(),
      accountId: asaasAccountId,
      name: `Alusa - Integração ${input.contaId.slice(0, 8)}`,
    });
  } catch (error) {
    return { ok: false, ...recoveryFailure(error, 'subaccount') };
  }

  const newApiKey = accessToken.apiKey?.trim();
  if (!newApiKey || !accessToken.id) {
    await revokeCreatedAccessToken(asaasAccountId, accessToken.id ?? '');
    return {
      ok: false,
      summary: 'O Asaas não retornou uma credencial utilizável para a subconta.',
      errorCode: 'ASAAS_KEY_RECOVERY_FAILED',
    };
  }

  try {
    const remoteAccount = await getMyAccount({ apiKey: newApiKey });
    if (!remoteAccountMatchesExpected({
      remoteAccount,
      expectedAsaasAccountId: asaasAccountId,
      contaCpfCnpj: conta.cpfCnpj,
    })) {
      await revokeCreatedAccessToken(asaasAccountId, accessToken.id);
      return {
        ok: false,
        summary: 'A nova credencial não pertence à subconta esperada.',
        errorCode: 'ACCOUNT_MISMATCH',
      };
    }
  } catch (error) {
    await revokeCreatedAccessToken(asaasAccountId, accessToken.id);
    return { ok: false, ...recoveryFailure(error, 'subaccount') };
  }

  let encryptedApiKey: string;
  try {
    encryptedApiKey = credentialVault.encrypt(newApiKey);
    credentialVault.verifyRoundTrip(encryptedApiKey, newApiKey);
  } catch {
    await revokeCreatedAccessToken(asaasAccountId, accessToken.id);
    return {
      ok: false,
      summary: 'A nova credencial foi validada, mas não pôde ser armazenada com segurança.',
      errorCode: 'ENCRYPTION_FAILED',
    };
  }

  const now = new Date();
  const actor = sanitizeActor(input.actor);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          apiKeyEncrypted: encryptedApiKey,
          apiKeyStatus: 'CONNECTED',
          apiKeyId: accessToken.id,
          apiKeyCreatedAt: parseProviderDate(accessToken.dateCreated) ?? now,
          apiKeyExpiresAt: parseProviderDate(accessToken.expirationDate),
          apiKeyProjectedExpirationAt: parseProviderDate(accessToken.projectedExpirationDateByLackOfUse),
          status: 'CREATED',
          webhookStatus: 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
          lastApiKeyCheckAt: now,
          provisionLastError: null,
        },
        select: { id: true },
      });

      await tx.asaasCredential.upsert({
        where: { financeProfileId: profile.id },
        update: { apiKeyEncrypted: encryptedApiKey },
        create: { financeProfileId: profile.id, apiKeyEncrypted: encryptedApiKey },
        select: { id: true },
      });
    });
  } catch {
    await revokeCreatedAccessToken(asaasAccountId, accessToken.id);
    return {
      ok: false,
      summary: 'A nova credencial foi validada, mas não pôde ser salva.',
      errorCode: 'SAVE_FAILED',
    };
  }

  const steps: AsaasSupportRepairStep[] = [
    { step: 'recover_api_key', summary: 'Nova credencial criada, validada e armazenada com segurança.' },
  ];
  const warnings: string[] = [];

  if (asaasAccount.apiKeyId && asaasAccount.apiKeyId !== accessToken.id) {
    try {
      await deleteSubaccountAccessToken({
        apiKey: getMasterAsaasApiKey(),
        accountId: asaasAccountId,
        accessTokenId: asaasAccount.apiKeyId,
      });
      steps.push({ step: 'revoke_previous_api_key', summary: 'Credencial anterior da Alusa revogada após a validação da nova.' });
    } catch {
      warnings.push('A credencial anterior não pôde ser revogada automaticamente.');
    }
  }

  try {
    await ensureWebhookReady(input.contaId);
    steps.push({ step: 'repair_webhook', summary: 'Webhook verificado e alinhado.' });
  } catch {
    warnings.push('A credencial foi recuperada, mas o webhook precisa ser verificado novamente.');
  }

  try {
    const reconciled = await reconcileAsaasAccount({
      contaId: input.contaId,
      actor,
      reason: input.reason,
    });
    if (reconciled.reconciled) steps.push({ step: 'reconcile', summary: 'Estado da subconta reconciliado com o Asaas.' });
  } catch {
    warnings.push('A credencial foi recuperada, mas a reconciliação precisa ser executada novamente.');
  }

  try {
    await syncAsaasOperationalStatus(input.contaId);
  } catch {
    warnings.push('A credencial foi recuperada, mas o status operacional será atualizado na próxima verificação.');
  }
  await auditLogService.record({
    contaId: input.contaId,
    action: 'finance.asaas.recover_subaccount_api_key',
    entity: { type: 'AsaasAccount', id: asaasAccount.id },
    metadata: {
      asaasAccountId,
      previousApiKeyId: asaasAccount.apiKeyId,
      newApiKeyId: accessToken.id,
      previousApiKeyRevoked: steps.some((step) => step.step === 'revoke_previous_api_key'),
      warnings,
      reason: input.reason,
    },
    actor,
  });

  if (warnings.length) steps.push({ step: 'warnings', summary: warnings.join(' ') });
  return {
    ok: true,
    steps,
    finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
  };
}

async function linkWhitelabelSubaccountCore(input: {
  contaId: string;
  asaasAccountId: string;
  reason: string;
  actor: { type: AuditActorType; id?: string };
}): Promise<{ ok: true; summary: string } | { ok: false; summary: string; errorCode: string }> {
  const trimmedId = input.asaasAccountId.trim();
  if (!trimmedId) {
    return {
      ok: false,
      summary: 'ID da subconta Asaas inválido.',
      errorCode: 'INVALID_SUBACCOUNT_ID',
    };
  }

  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { id: true, financeIntegrationMode: true, cpfCnpj: true },
  });

  if (!conta) {
    return { ok: false, summary: 'Conta não encontrada.', errorCode: 'NO_CONTA' };
  }
  if (conta.financeIntegrationMode !== FinanceIntegrationMode.WHITELABEL_BAAS) {
    return {
      ok: false,
      summary: 'Modo financeiro não é white-label BaaS.',
      errorCode: 'NOT_WHITELABEL_BAAS',
    };
  }
  const docDigits = conta.cpfCnpj ? normalizeCpfCnpjDigits(conta.cpfCnpj) : '';
  if (!docDigits) {
    return {
      ok: false,
      summary: 'Conta sem CPF/CNPJ cadastrado; não é possível validar a subconta.',
      errorCode: 'MISSING_CONTA_DOCUMENT',
    };
  }

  let masterKey: string;
  try {
    masterKey = getMasterAsaasApiKey();
  } catch {
    return {
      ok: false,
      summary: 'ASAAS_API_KEY (master) não configurada.',
      errorCode: 'MASTER_KEY_MISSING',
    };
  }

  let remote;
  try {
    remote = await getSubaccount({ apiKey: masterKey, accountId: trimmedId });
  } catch {
    return {
      ok: false,
      summary:
        'Não foi possível ler a subconta no Asaas com a chave master (ID inexistente ou sem permissão).',
      errorCode: 'ASAAS_SUBACCOUNT_LOOKUP_FAILED',
    };
  }

  const remoteDigits = normalizeCpfCnpjDigits(remote.cpfCnpj ?? '');
  if (remoteDigits !== docDigits) {
    return {
      ok: false,
      summary: 'CPF/CNPJ da subconta no Asaas não confere com o documento da conta na Alusa.',
      errorCode: 'DOCUMENT_MISMATCH',
    };
  }

  await startFinancialOnboarding({ contaId: input.contaId, actor: input.actor }).catch(
    () => undefined,
  );

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: { id: true },
  });
  if (!profile) {
    return {
      ok: false,
      summary: 'FinanceProfile não encontrado após bootstrap.',
      errorCode: 'NO_FINANCE_PROFILE',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.financeProfile.update({
        where: { id: profile.id },
        data: { asaasAccountId: trimmedId },
      });
      await tx.asaasAccount.upsert({
        where: { financeProfileId: profile.id },
        create: {
          financeProfileId: profile.id,
          asaasAccountId: trimmedId,
          status: 'CREATED',
          statusUpdatedAt: new Date(),
          apiKeyStatus: 'MISSING',
          provisionedAt: new Date(),
          provisionLastError: null,
        },
        update: {
          asaasAccountId: trimmedId,
          status: 'CREATED',
          statusUpdatedAt: new Date(),
          provisionedAt: new Date(),
          provisionLastError: null,
        },
      });
    });
  } catch (e) {
    const code =
      typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
    if (code === 'P2002') {
      return {
        ok: false,
        summary:
          'Este ID de subconta Asaas já está vinculado a outra conta na Alusa ou há conflito de unicidade.',
        errorCode: 'SUBACCOUNT_ID_CONFLICT',
      };
    }
    throw e;
  }

  await auditLogService.record({
    contaId: input.contaId,
    action: 'finance.support.link_whitelabel_subaccount',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: { asaasAccountId: trimmedId, reason: input.reason },
    actor: input.actor,
  });

  return {
    ok: true,
    summary: `Subconta ${trimmedId} vinculada à conta. Agora é possível recuperar o acesso pela integração.`,
  };
}

export async function executeAsaasSupportRepair(input: {
  contaId: string;
  reason: string;
  action: AsaasSupportRepairExecuteAction;
  linkAsaasAccountId?: string | null;
  actor: { type: AuditActorType; id?: string | null };
}): Promise<ExecuteAsaasSupportRepairOk | ExecuteAsaasSupportRepairFail> {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    return {
      ok: false,
      summary: 'Informe um motivo com pelo menos 8 caracteres.',
      errorCode: 'REASON_TOO_SHORT',
    };
  }

  if (input.action === 'LINK_SUBACCOUNT') {
    const linkId = input.linkAsaasAccountId?.trim();
    if (!linkId) {
      return {
        ok: false,
        summary: 'Informe o ID da subconta para vincular.',
        errorCode: 'LINK_ID_REQUIRED',
      };
    }
    const linked = await linkWhitelabelSubaccountCore({
      contaId: input.contaId,
      asaasAccountId: linkId,
      reason,
      actor: sanitizeActor(input.actor),
    });
    if (!linked.ok) {
      return { ok: false, summary: linked.summary, errorCode: linked.errorCode };
    }
    return {
      ok: true,
      steps: [{ step: 'link_subaccount', summary: linked.summary }],
      finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
    };
  }

  if (input.action === 'RECOVER_API_KEY') {
    const locked = await withAdvisoryLock(
      `asaas-api-key-recovery:${input.contaId}`,
      () => recoverSubaccountApiKeyCore({
        contaId: input.contaId,
        reason,
        actor: sanitizeActor(input.actor),
      }),
      { timeout: 60000, logContext: { contaId: input.contaId } },
    );

    if (!locked.acquired) {
      return {
        ok: false,
        summary: 'A recuperação desta credencial já está em andamento. Aguarde e atualize o diagnóstico.',
        errorCode: 'RECOVERY_IN_PROGRESS',
      };
    }

    return locked.result;
  }

  if (input.action === 'BOOTSTRAP_LOCAL') {
    await startFinancialOnboarding({ contaId: input.contaId, actor: sanitizeActor(input.actor) });
    return {
      ok: true,
      steps: [
        {
          step: 'bootstrap',
          summary: 'Onboarding financeiro iniciado (perfil + placeholder Asaas).',
        },
      ],
      finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
    };
  }

  if (input.action === 'ENQUEUE_PROVISION') {
    try {
      const r = await enqueueAsaasSubaccountProvisioning({
        contaId: input.contaId,
        actor: sanitizeActor(input.actor),
      });
      let summary = '';
      if (r.status === 'CONNECTED') {
        summary = 'Subconta já estava conectada.';
      } else if (r.status === 'RECOVERY_REQUIRED') {
        summary = 'Provisionamento requer recuperação da credencial pela integração.';
      } else if (r.queued) {
        summary = 'Job de provisionamento enfileirado. Aguarde o processamento.';
      } else {
        summary = `Provisionamento: ${r.status}.`;
      }
      return {
        ok: true,
        steps: [{ step: 'enqueue_provision', summary }],
        finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao enfileirar provisionamento.';
      return { ok: false, summary: msg, errorCode: 'ENQUEUE_FAILED' };
    }
  }

  if (input.action === 'REPAIR_WEBHOOK') {
    const repair = await repairWebhookConfigDrift({
      contaId: input.contaId,
      actor: sanitizeActor(input.actor),
    });
    const summary =
      repair.reason === 'REPAIRED'
        ? 'Webhook reparado ou criado conforme expectativa.'
        : repair.reason === 'NO_DRIFT'
          ? 'Nenhum desvio de webhook detectado.'
          : `Webhook não reparado: ${repair.reason}.`;
    return {
      ok: true,
      steps: [{ step: 'repair_webhook', summary }],
      finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
    };
  }

  if (input.action === 'RECONCILE') {
    const rec = await reconcileAsaasAccount({
      contaId: input.contaId,
      actor: sanitizeActor(input.actor),
      reason,
    });
    const summary = rec.reconciled
      ? `Reconciliação concluída (status: ${rec.updatedStatus}).`
      : 'Nada a reconciliar ou subconta ainda sem ID.';
    return {
      ok: true,
      steps: [{ step: 'reconcile', summary }],
      finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
    };
  }

  return { ok: false, summary: 'Ação de reparo não suportada.', errorCode: 'UNSUPPORTED_ACTION' };
}
