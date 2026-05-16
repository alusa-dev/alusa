import { getSubaccount } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import { normalizeCpfCnpjDigits } from '@alusa/lib';
import { FinanceIntegrationMode, type AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
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
import { recoverWhitelabelBaasViaParentAccount } from './recover-whitelabel-baas-via-parent';

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
  | 'WEBHOOK_DRIFT'
  | 'CONNECTED_HEALTHY';

export type AsaasSupportRecommendedAction =
  | 'NONE'
  | 'WAIT'
  | 'BOOTSTRAP_LOCAL'
  | 'ENQUEUE_PROVISION'
  | 'RECOVER_INTEGRATION'
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
  needsApiKeyRecovery: boolean;
  integrationOperational: boolean;
  webhookDrift: boolean | null;
  recoveryStuckWithoutSubaccountId: boolean;
  recommendedAction: AsaasSupportRecommendedAction;
  hint: string;
};

export type AsaasSupportRepairExecuteAction =
  | 'AUTO_NEXT'
  | 'BOOTSTRAP_LOCAL'
  | 'ENQUEUE_PROVISION'
  | 'RECOVER_INTEGRATION'
  | 'REPAIR_WEBHOOK'
  | 'RECONCILE'
  | 'LINK_SUBACCOUNT';

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
              provisionLastError: true,
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
      needsApiKeyRecovery: false,
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
        conta.financeProfile?.asaasAccount?.asaasAccountId ?? conta.financeProfile?.asaasAccountId ?? null,
      canCreateSubaccount: false,
      missingWizardFields: [],
      provisionJob: null,
      webhookJob: null,
      needsApiKeyRecovery: false,
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

  const integrationOperational = Boolean(
    asaasRow?.apiKeyEncrypted && asaasRow.apiKeyStatus === 'CONNECTED',
  );

  const needsApiKeyRecovery = asaasRow
    ? needsSubaccountKeyRecovery({
        apiKeyEncrypted: asaasRow.apiKeyEncrypted,
        apiKeyStatus: asaasRow.apiKeyStatus,
      })
    : true;

  const recoveryStuckWithoutSubaccountId =
    Boolean(asaasRow?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX)) && !effectiveAsaasAccountId;

  let webhookDrift: boolean | null = null;
  if (integrationOperational) {
    const driftStatus = await getWebhookConfigDriftStatus(contaId).catch(() => null);
    webhookDrift = driftStatus ? hasActionableWebhookDrift(driftStatus) : null;
  }

  let phase: AsaasSupportRepairPhase = 'CONNECTED_HEALTHY';
  let recommendedAction: AsaasSupportRecommendedAction = 'RECONCILE';
  let hint = 'Integração operacional. Reconciliar alinha estado local com o Asaas.';

  if (!profile || !asaasRow) {
    phase = 'LOCAL_BOOTSTRAP_NEEDED';
    recommendedAction = 'BOOTSTRAP_LOCAL';
    hint = 'Criar perfil financeiro e registro local Asaas (placeholder) antes de provisionar ou vincular.';
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
    hint = 'Job de provisionamento de subconta em andamento ou na fila. Aguarde o worker ou execute o processador de jobs.';
  } else if (integrationOperational && webhookJob) {
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
  } else if (
    effectiveAsaasAccountId &&
    (needsApiKeyRecovery ||
      (!integrationOperational &&
        Boolean(asaasRow?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX))))
  ) {
    phase = 'API_KEY_OR_SUBACCOUNT_RECOVERY';
    recommendedAction = 'RECOVER_INTEGRATION';
    hint =
      'Gerar chave via conta master, reparar webhooks e reconciliar (requer gestão de chaves de subconta habilitada no Asaas).';
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
    webhookJob,
    needsApiKeyRecovery,
    integrationOperational,
    webhookDrift,
    recoveryStuckWithoutSubaccountId,
    recommendedAction,
    hint,
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
    return { ok: false, summary: 'ID da subconta Asaas inválido.', errorCode: 'INVALID_SUBACCOUNT_ID' };
  }

  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { id: true, financeIntegrationMode: true, cpfCnpj: true },
  });

  if (!conta) {
    return { ok: false, summary: 'Conta não encontrada.', errorCode: 'NO_CONTA' };
  }
  if (conta.financeIntegrationMode !== FinanceIntegrationMode.WHITELABEL_BAAS) {
    return { ok: false, summary: 'Modo financeiro não é white-label BaaS.', errorCode: 'NOT_WHITELABEL_BAAS' };
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
    return { ok: false, summary: 'ASAAS_API_KEY (master) não configurada.', errorCode: 'MASTER_KEY_MISSING' };
  }

  let remote;
  try {
    remote = await getSubaccount({ apiKey: masterKey, accountId: trimmedId });
  } catch {
    return {
      ok: false,
      summary: 'Não foi possível ler a subconta no Asaas com a chave master (ID inexistente ou sem permissão).',
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

  await startFinancialOnboarding({ contaId: input.contaId, actor: input.actor }).catch(() => undefined);

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: { id: true },
  });
  if (!profile) {
    return { ok: false, summary: 'FinanceProfile não encontrado após bootstrap.', errorCode: 'NO_FINANCE_PROFILE' };
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
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
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
    summary: `Subconta ${trimmedId} vinculada à conta. Em seguida use recuperação de chave para credenciais e webhooks.`,
  };
}

const MAX_AUTO_STEPS = 10;

export async function executeAsaasSupportRepair(input: {
  contaId: string;
  reason: string;
  action: AsaasSupportRepairExecuteAction;
  linkAsaasAccountId?: string | null;
  actor: { type: AuditActorType; id?: string | null };
}): Promise<ExecuteAsaasSupportRepairOk | ExecuteAsaasSupportRepairFail> {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    return { ok: false, summary: 'Informe um motivo com pelo menos 8 caracteres.', errorCode: 'REASON_TOO_SHORT' };
  }

  if (input.action === 'LINK_SUBACCOUNT') {
    const linkId = input.linkAsaasAccountId?.trim();
    if (!linkId) {
      return { ok: false, summary: 'Informe o ID da subconta para vincular.', errorCode: 'LINK_ID_REQUIRED' };
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

  if (input.action === 'BOOTSTRAP_LOCAL') {
    await startFinancialOnboarding({ contaId: input.contaId, actor: sanitizeActor(input.actor) });
    return {
      ok: true,
      steps: [{ step: 'bootstrap', summary: 'Onboarding financeiro iniciado (perfil + placeholder Asaas).' }],
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
        summary = 'Provisionamento requer recuperação manual de chave (via conta master).';
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

  if (input.action === 'RECOVER_INTEGRATION') {
    const result = await recoverWhitelabelBaasViaParentAccount({
      contaId: input.contaId,
      reason,
      actor: sanitizeActor(input.actor),
    });
    if (!result.ok) {
      return {
        ok: false,
        summary: result.summary,
        errorCode: result.errorCode,
        finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId).catch(() => undefined),
      };
    }
    return {
      ok: true,
      steps: [{ step: 'recover', summary: result.summary }],
      finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
    };
  }

  if (input.action === 'REPAIR_WEBHOOK') {
    const repair = await repairWebhookConfigDrift({ contaId: input.contaId, actor: sanitizeActor(input.actor) });
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

  // AUTO_NEXT
  const steps: AsaasSupportRepairStep[] = [];
  for (let i = 0; i < MAX_AUTO_STEPS; i++) {
    const d = await diagnoseAsaasSupportRepair(input.contaId);

    if (d.phase === 'NOT_WHITELABEL_BAAS' || d.phase === 'NO_CONTA') {
      return {
        ok: false,
        summary: d.hint,
        errorCode: d.phase === 'NO_CONTA' ? 'NO_CONTA' : 'NOT_WHITELABEL_BAAS',
        finalDiagnosis: d,
      };
    }

    switch (d.recommendedAction) {
      case 'NONE':
      case 'COMPLETE_WIZARD':
      case 'WAIT':
        return { ok: true, steps, finalDiagnosis: d };
      case 'LINK_SUBACCOUNT': {
        return {
          ok: false,
          summary: `${d.hint} Use a ação explícita de vínculo com o ID da subconta.`,
          errorCode: 'LINK_SUBACCOUNT_REQUIRED',
          finalDiagnosis: d,
        };
      }
      case 'BOOTSTRAP_LOCAL': {
        await startFinancialOnboarding({ contaId: input.contaId, actor: sanitizeActor(input.actor) });
        steps.push({
          step: 'bootstrap',
          summary: 'Perfil financeiro e placeholder Asaas garantidos.',
        });
        break;
      }
      case 'ENQUEUE_PROVISION': {
        try {
          const r = await enqueueAsaasSubaccountProvisioning({
            contaId: input.contaId,
            actor: sanitizeActor(input.actor),
          });
          if (r.queued) {
            steps.push({ step: 'enqueue_provision', summary: 'Provisionamento enfileirado.' });
            return { ok: true, steps, finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId) };
          }
          steps.push({
            step: 'enqueue_provision',
            summary: `Provisionamento: ${r.status}.`,
          });
          if (r.status === 'CONNECTED') break;
          if (r.status === 'RECOVERY_REQUIRED') break;
          break;
        } catch (e) {
          return {
            ok: false,
            summary: e instanceof Error ? e.message : 'Falha ao enfileirar provisionamento.',
            errorCode: 'ENQUEUE_FAILED',
            finalDiagnosis: d,
          };
        }
      }
      case 'RECOVER_INTEGRATION': {
        const result = await recoverWhitelabelBaasViaParentAccount({
          contaId: input.contaId,
          reason,
          actor: sanitizeActor(input.actor),
        });
        if (!result.ok) {
          return {
            ok: false,
            summary: result.summary,
            errorCode: result.errorCode,
            finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
          };
        }
        steps.push({ step: 'recover', summary: result.summary });
        break;
      }
      case 'REPAIR_WEBHOOK': {
        const repair = await repairWebhookConfigDrift({ contaId: input.contaId, actor: sanitizeActor(input.actor) });
        steps.push({
          step: 'repair_webhook',
          summary:
            repair.reason === 'REPAIRED'
              ? 'Webhook ajustado.'
              : repair.reason === 'NO_DRIFT'
                ? 'Webhook já alinhado.'
                : `Webhook: ${repair.reason}.`,
        });
        break;
      }
      case 'RECONCILE': {
        const rec = await reconcileAsaasAccount({
          contaId: input.contaId,
          actor: sanitizeActor(input.actor),
          reason,
        });
        steps.push({
          step: 'reconcile',
          summary: rec.reconciled ? 'Estado reconciliado com o Asaas.' : 'Reconciliação sem alterações.',
        });
        return { ok: true, steps, finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId) };
      }
      default:
        return { ok: true, steps, finalDiagnosis: d };
    }
  }

  return {
    ok: false,
    summary: 'Limite de etapas automáticas excedido; continue com ações manuais.',
    errorCode: 'AUTO_NEXT_LIMIT',
    finalDiagnosis: await diagnoseAsaasSupportRepair(input.contaId),
  };
}
