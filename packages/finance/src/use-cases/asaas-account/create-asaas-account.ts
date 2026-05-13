import {
  createSubaccount,
  createSubaccountAccessToken,
  createWebhook,
  listSubaccountAccessTokens,
  listSubaccounts,
  listWebhooks,
  updateWebhook,
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { Prisma, type AuditActorType, type FinancialOnboardingStatus } from '@prisma/client';
import { detectPersonType } from '@alusa/shared';

import { auditLogService } from '../../foundation/audit-log.service';
import { validateSubaccountApiKey } from '../../foundation/asaas-api-key';
import { credentialVault } from '../../foundation/credential-vault';
import { financeProfileService } from '../../foundation/finance-profile.service';
import { createAsaasAccountSchema } from '../../foundation/schemas';
import { withAdvisoryLock } from '../../foundation/advisory-lock';
import { MissingBirthDateError } from '../../errors/missing-birth-date-error';
import { MissingCompanyTypeError } from '../../errors/missing-company-type-error';
import { AsaasSandboxSubaccountDailyLimitError } from '../../errors/asaas-sandbox-subaccount-daily-limit-error';
import { getMasterAsaasApiKey, resolveWebhookUrlOrNull } from './asaas-env';
import {
  buildExpectedWebhookConfig,
  hasSameWebhookEvents,
  normalizeWebhookUrlBase,
  RECOMMENDED_WEBHOOK_NAME,
  RECOMMENDED_WEBHOOK_SEND_TYPE,
} from './expected-webhook-config.server';
import { buildWebhookAuthTokenRotationData } from '../../webhooks/asaas-webhook-auth';
import {
  deriveLegacyAliasedSubaccountEmail,
  matchesSubaccountEmail,
  resolveCanonicalSubaccountEmail,
} from './subaccount-email';
import { resolveWebhookNotificationEmail } from './webhook-notification-email.server';

// ============================================================================
// Helpers: Error detection
// ============================================================================

/**
 * Detecta se o erro é não-determinístico (timeout, network, 5xx).
 * Nesses casos, a subconta pode ter sido criada no Asaas mas não confirmada.
 */
function isNonDeterministicError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  // Timeout / network errors
  const errorAsAny = error as { code?: string; name?: string; status?: number };
  if (errorAsAny.code === 'ECONNRESET' || errorAsAny.code === 'ETIMEDOUT') return true;
  if (errorAsAny.code === 'ENOTFOUND' || errorAsAny.code === 'ECONNREFUSED') return true;
  if (errorAsAny.name === 'AbortError' || errorAsAny.name === 'TimeoutError') return true;

  // HTTP 5xx errors
  if (typeof errorAsAny.status === 'number' && errorAsAny.status >= 500 && errorAsAny.status < 600) {
    return true;
  }

  // Verificar mensagens comuns
  const message = 'message' in error && typeof (error as { message?: unknown }).message === 'string'
    ? ((error as { message: string }).message).toLowerCase()
    : '';
  if (message.includes('timeout') || message.includes('network') || message.includes('econnreset')) {
    return true;
  }

  return false;
}

/**
 * Extrai informações do erro para logging.
 * Nunca inclui dados sensíveis (CPF, CNPJ, apiKey).
 */
function extractErrorInfo(error: unknown): { message: string; code?: string; status?: number } {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }
  const e = error as { message?: string; code?: string; status?: number };
  return {
    message: e.message ?? 'Unknown error',
    code: e.code,
    status: e.status,
  };
}

// ============================================================================
// Idempotência: statuses que indicam subconta já criada/conectada
// ============================================================================
const CONNECTED_STATUSES: FinancialOnboardingStatus[] = ['CREATED', 'UNDER_REVIEW', 'APPROVED'];
const ACTIVE_STATUSES: FinancialOnboardingStatus[] = ['IN_PROGRESS', ...CONNECTED_STATUSES];

/**
 * Verifica se já existe uma subconta válida e conectada para o contaId.
 * Retorna os dados se existir, null caso contrário.
 */
async function findExistingConnectedAccount(financeProfileId: string): Promise<{
  id: string;
  asaasAccountId: string;
  status: FinancialOnboardingStatus;
  apiKeyEncrypted: string | null;
  apiKeyStatus: string;
  webhookAuthTokenHash: string | null;
} | null> {
  const existing = await prisma.asaasAccount.findUnique({
    where: { financeProfileId },
    select: {
      id: true,
      asaasAccountId: true,
      status: true,
      apiKeyEncrypted: true,
      apiKeyStatus: true,
      webhookAuthTokenHash: true,
    },
  });

  if (!existing?.asaasAccountId) {
    return null;
  }

  // Se está em status conectado e tem apiKey válida, considerar como já criada
  if (
    CONNECTED_STATUSES.includes(existing.status) &&
    existing.apiKeyEncrypted &&
    existing.apiKeyStatus === 'CONNECTED'
  ) {
    return {
      id: existing.id,
      asaasAccountId: existing.asaasAccountId,
      status: existing.status,
      apiKeyEncrypted: existing.apiKeyEncrypted,
      apiKeyStatus: existing.apiKeyStatus,
      webhookAuthTokenHash: existing.webhookAuthTokenHash,
    };
  }

  return null;
}

/**
 * Retorna snapshot idempotente quando a subconta já existe e está em andamento.
 */
async function findExistingAccountSnapshot(financeProfileId: string): Promise<{
  id: string;
  asaasAccountId: string;
  status: FinancialOnboardingStatus;
} | null> {
  const existing = await prisma.asaasAccount.findUnique({
    where: { financeProfileId },
    select: {
      id: true,
      asaasAccountId: true,
      status: true,
    },
  });

  if (!existing?.asaasAccountId) {
    return null;
  }

  if (!ACTIVE_STATUSES.includes(existing.status)) {
    return null;
  }

  return {
    id: existing.id,
    asaasAccountId: existing.asaasAccountId,
    status: existing.status,
  };
}

function normalizeCpfCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

function toDateOnlyUtcString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

type ResolvedContaIdentity = NonNullable<Awaited<ReturnType<typeof tryResolveContaIdentity>>>;
type RemoteSubaccount = Awaited<ReturnType<typeof listSubaccounts>>['data'][number];

function matchesRecoverableSubaccount(params: {
  remoteAccount: RemoteSubaccount;
  identity: ResolvedContaIdentity;
  contaId: string;
}): boolean {
  const expectedCpfCnpj = normalizeCpfCnpj(params.identity.cpfCnpj ?? '');
  if (!expectedCpfCnpj) return false;

  const remoteCpfCnpj = normalizeCpfCnpj(params.remoteAccount.cpfCnpj ?? '');
  if (remoteCpfCnpj !== expectedCpfCnpj) return false;

  // Computa alias legado sob demanda apenas para reconciliação de subcontas antigas
  const legacyAlias = deriveLegacyAliasedSubaccountEmail(params.identity.email, params.contaId);

  return matchesSubaccountEmail({
    remoteEmail: params.remoteAccount.email,
    remoteLoginEmail: params.remoteAccount.loginEmail,
    canonicalEmail: params.identity.email,
    legacyAliasedEmail: legacyAlias,
  });
}

async function findRecoverableSubaccountByIdentity(params: {
  apiKey: string;
  identity: ResolvedContaIdentity;
  contaId: string;
}): Promise<RemoteSubaccount | null> {
  const cpfCnpj = normalizeCpfCnpj(params.identity.cpfCnpj ?? '');
  if (!cpfCnpj) return null;

  const response = await listSubaccounts({
    apiKey: params.apiKey,
    cpfCnpj,
    limit: 10,
    offset: 0,
  });

  return (
    response.data.find((remoteAccount) =>
      matchesRecoverableSubaccount({
        remoteAccount,
        identity: params.identity,
        contaId: params.contaId,
      }),
    ) ?? null
  );
}

async function createProvisioningAccessToken(params: {
  contaId: string;
  accountId: string;
}): Promise<{
  accessToken: Awaited<ReturnType<typeof createSubaccountAccessToken>>;
  existingAccessTokenCount: number;
}> {
  const apiKey = getMasterAsaasApiKey();
  const existingTokens = await listSubaccountAccessTokens({
    apiKey,
    accountId: params.accountId,
    limit: 100,
    offset: 0,
  });

  const accessToken = await createSubaccountAccessToken({
    apiKey,
    accountId: params.accountId,
    name: buildAccessTokenName(params.contaId),
  });

  return {
    accessToken,
    existingAccessTokenCount: existingTokens.data.length,
  };
}

async function persistRecoveredSubaccount(params: {
  contaId: string;
  financeProfileId: string;
  recoveredAccount: RemoteSubaccount;
  externalReference: string;
  webhookAuthTokenHash: string;
  actor?: { type: AuditActorType; id?: string };
  auditAction: string;
  auditMetadata?: Record<string, unknown>;
  created: boolean;
  idempotent?: boolean;
}): Promise<CreateAsaasAccountResult> {
  const { accessToken, existingAccessTokenCount } = await createProvisioningAccessToken({
    contaId: params.contaId,
    accountId: params.recoveredAccount.id,
  });

  const encryptedApiKey = credentialVault.encrypt(accessToken.apiKey);
  const apiKeyStatus = await validateSubaccountApiKey(accessToken.apiKey);
  const now = new Date();

  const recovered = await prisma.$transaction(async (tx) => {
    const asaasAccount = await tx.asaasAccount.upsert({
      where: { financeProfileId: params.financeProfileId },
      create: {
        financeProfileId: params.financeProfileId,
        asaasAccountId: params.recoveredAccount.id,
        asaasAccountEmail: params.recoveredAccount.email,
        externalReference: params.externalReference,
        status: 'CREATED',
        statusUpdatedAt: now,
        provisionedAt: now,
        apiKeyEncrypted: encryptedApiKey,
        apiKeyStatus,
        webhookAuthTokenHash: params.webhookAuthTokenHash,
        provisionLastError: null,
      },
      update: {
        asaasAccountId: params.recoveredAccount.id,
        asaasAccountEmail: params.recoveredAccount.email,
        status: 'CREATED',
        statusUpdatedAt: now,
        provisionedAt: { set: now },
        apiKeyEncrypted: encryptedApiKey,
        apiKeyStatus,
        webhookAuthTokenHash: params.webhookAuthTokenHash,
        provisionLastError: null,
      },
    });

    await tx.financeProfile.update({
      where: { id: params.financeProfileId },
      data: { asaasAccountId: params.recoveredAccount.id },
      select: { id: true },
    });

    await tx.asaasCredential.upsert({
      where: { financeProfileId: params.financeProfileId },
      create: {
        financeProfileId: params.financeProfileId,
        apiKeyEncrypted: encryptedApiKey,
      },
      update: {
        apiKeyEncrypted: encryptedApiKey,
      },
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: params.auditAction,
      entity: { type: 'AsaasAccount', id: asaasAccount.id },
      metadata: {
        asaasAccountId: params.recoveredAccount.id,
        externalReference: params.externalReference,
        accessTokenId: accessToken.id,
        existingAccessTokenCount,
        ...params.auditMetadata,
      },
      actor: params.actor,
    });

    return asaasAccount;
  });

  try {
    await ensureExistingWebhookConfig({
      contaId: params.contaId,
      financeProfileId: params.financeProfileId,
      asaasAccountId: params.recoveredAccount.id,
      webhookAuthTokenHash: params.webhookAuthTokenHash,
      actor: params.actor,
    });
  } catch (error) {
    if (isWebhookConfigurationError(error)) throw error;
  }

  return {
    financeProfileId: params.financeProfileId,
    asaasAccountId: params.recoveredAccount.id,
    status: recovered.status,
    created: params.created,
    ...(params.idempotent ? { idempotent: true } : {}),
  };
}

async function tryRecoverExistingRemoteSubaccount(params: {
  contaId: string;
  financeProfileId: string;
  identity: ResolvedContaIdentity;
  externalReference: string;
  webhookAuthTokenHash: string;
  actor?: { type: AuditActorType; id?: string };
  recoveryReason: 'PRE_CREATE_RECONCILIATION' | 'POST_CREATE_TIMEOUT' | 'POST_CREATE_CONFLICT';
  created: boolean;
  idempotent?: boolean;
}): Promise<CreateAsaasAccountResult | null> {
  const recoveredAccount = await findRecoverableSubaccountByIdentity({
    apiKey: getMasterAsaasApiKey(),
    identity: params.identity,
    contaId: params.contaId,
  });

  if (!recoveredAccount) {
    return null;
  }

  console.info('[finance.createAsaasAccount] Subconta remota reconciliada por identidade', {
    contaId: params.contaId,
    financeProfileId: params.financeProfileId,
    asaasAccountId: recoveredAccount.id,
    recoveryReason: params.recoveryReason,
  });

  return persistRecoveredSubaccount({
    contaId: params.contaId,
    financeProfileId: params.financeProfileId,
    recoveredAccount,
    externalReference: params.externalReference,
    webhookAuthTokenHash: params.webhookAuthTokenHash,
    actor: params.actor,
    auditAction:
      params.recoveryReason === 'PRE_CREATE_RECONCILIATION'
        ? 'finance.onboarding.recover_existing_subaccount'
        : 'finance.onboarding.recover_subaccount_after_error',
    auditMetadata: {
      recoveryReason: params.recoveryReason,
      lookupStrategy: 'cpfCnpj+canonicalOrLegacyEmail',
    },
    created: params.created,
    idempotent: params.idempotent,
  });
}

type CompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';

function normalizeCompanyType(value: string | null | undefined): CompanyType | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'MEI') return 'MEI';
  if (normalized === 'LIMITED') return 'LIMITED';
  if (normalized === 'INDIVIDUAL') return 'INDIVIDUAL';
  if (normalized === 'ASSOCIATION') return 'ASSOCIATION';
  return undefined;
}

const ACCESS_TOKEN_NAME_PREFIX = 'Alusa - API Key';

async function ensureExistingWebhookConfig(params: {
  contaId: string;
  financeProfileId: string;
  asaasAccountId: string;
  webhookAuthTokenHash: string | null;
  actor?: { type: AuditActorType; id?: string };
}) {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials?.apiKey) return;

  const webhookUrl = resolveWebhookUrlOrNull();
  if (!webhookUrl) {
    throw new Error(
      'ASAAS_WEBHOOK_PUBLIC_BASE_URL ou NEXT_PUBLIC_APP_URL deve apontar para uma URL pública https para configurar o webhook do Asaas.',
    );
  }

  const expectedWebhook = buildExpectedWebhookConfig(params.financeProfileId, webhookUrl);
  const webhookNotificationEmail = await resolveWebhookNotificationEmail({
    contaId: params.contaId,
    financeProfileId: params.financeProfileId,
  });
  if (!webhookNotificationEmail) {
    throw new Error('Não foi possível resolver o email do webhook do Asaas.');
  }
  const webhooks = await listWebhooks({ apiKey: credentials.apiKey, limit: 100, offset: 0 });
  const webhook = webhooks.data.find(
    (item) =>
      normalizeWebhookUrlBase(item.url) === expectedWebhook.normalizedUrl ||
      item.name === RECOMMENDED_WEBHOOK_NAME,
  );

  if (!webhook) {
    // Webhook não existe na subconta — cria em vez de falhar (subconta pode ter sido criada antes da configuração do webhook)
    await createWebhook({
      apiKey: credentials.apiKey,
      data: {
        name: RECOMMENDED_WEBHOOK_NAME,
        url: webhookUrl,
        email: webhookNotificationEmail,
        enabled: true,
        authToken: expectedWebhook.authToken,
        sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
        events: expectedWebhook.events,
      },
    });

    if (params.webhookAuthTokenHash !== expectedWebhook.authTokenHash) {
      await prisma.asaasAccount.update({
        where: { financeProfileId: params.financeProfileId },
        data: buildWebhookAuthTokenRotationData({
          currentHash: params.webhookAuthTokenHash,
          nextHash: expectedWebhook.authTokenHash,
        }),
        select: { id: true },
      });
    }

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.onboarding.create_webhook_config',
      entity: { type: 'AsaasAccount', id: params.asaasAccountId },
      metadata: { asaasAccountId: params.asaasAccountId, webhookCreated: true },
      actor: params.actor,
    });
    return;
  }

  const shouldRepairRemote =
    params.webhookAuthTokenHash !== expectedWebhook.authTokenHash ||
    webhook.enabled === false ||
    webhook.interrupted === true ||
    webhook.hasAuthToken === false ||
    webhook.sendType !== RECOMMENDED_WEBHOOK_SEND_TYPE ||
    !hasSameWebhookEvents(webhook.events, expectedWebhook.events);

  if (!shouldRepairRemote) return;

  await updateWebhook({
    apiKey: credentials.apiKey,
    webhookId: webhook.id,
    data: {
      name: RECOMMENDED_WEBHOOK_NAME,
      url: webhookUrl,
      email: webhookNotificationEmail,
      enabled: true,
      interrupted: false,
      authToken: expectedWebhook.authToken,
      sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
      events: expectedWebhook.events,
    },
  });

  if (params.webhookAuthTokenHash !== expectedWebhook.authTokenHash) {
    await prisma.asaasAccount.update({
      where: { financeProfileId: params.financeProfileId },
      data: buildWebhookAuthTokenRotationData({
        currentHash: params.webhookAuthTokenHash,
        nextHash: expectedWebhook.authTokenHash,
      }),
      select: { id: true },
    });
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.repair_webhook_config',
    entity: { type: 'AsaasAccount', id: params.asaasAccountId },
    metadata: {
      webhookId: webhook.id,
      asaasAccountId: params.asaasAccountId,
      repairedInterrupted: webhook.interrupted === true,
      repairedMissingToken: webhook.hasAuthToken === false,
      repairedHashDrift: params.webhookAuthTokenHash !== expectedWebhook.authTokenHash,
    },
    actor: params.actor,
  });
}

function isWebhookConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET') ||
    error.message.includes('ASAAS_WEBHOOK_PUBLIC_BASE_URL') ||
    error.message.includes('NEXT_PUBLIC_APP_URL') ||
    error.message.includes('Webhook financeiro do Asaas não encontrado na subconta')
  );
}

function normalizeMobilePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('mobilePhone inválido');
  if (digits.length < 10 || digits.length > 13) throw new Error('mobilePhone inválido');
  return digits;
}

function financeProfileExternalReference(financeProfileId: string): string {
  return `financeProfile:${financeProfileId}`;
}

function buildAccessTokenName(contaId: string): string {
  const suffix = contaId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return suffix ? `${ACCESS_TOKEN_NAME_PREFIX} ${suffix}` : ACCESS_TOKEN_NAME_PREFIX;
}

async function tryResolveContaIdentity(
  contaId: string,
  financeProfileId: string,
): Promise<{
  ownerName: string;
  companyName: string | null;
  legacyName: string | null;
  email: string;
  cpfCnpj: string | null;
  birthDate: string | null;
} | null> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      cpfCnpj: true,
      ownerUserId: true,
    },
  });

  if (!conta) {
    throw new Error('Conta não encontrada');
  }

  const ownerUser = conta.ownerUserId
    ? await prisma.usuario
      .findUnique({ where: { id: conta.ownerUserId }, select: { email: true, birthDate: true } })
      .then((u) => u ?? null)
    : null;

  const fallbackUser = ownerUser
    ? ownerUser
    : await prisma.usuario
      .findFirst({ where: { contaId }, select: { email: true, birthDate: true }, orderBy: { createdAt: 'asc' } })
      .then((u) => u ?? null);

  if (!fallbackUser?.email) {
    return null;
  }

  const profile = await prisma.financeProfile.findUnique({
    where: { id: financeProfileId },
    select: { asaasOwnerName: true, asaasCompanyName: true, asaasName: true, draftCpfCnpj: true, draftBirthDate: true },
  });

  const ownerName = profile?.asaasOwnerName?.trim() ?? profile?.asaasName?.trim();
  if (!ownerName) {
    return null;
  }
  const legacyName = profile?.asaasName?.trim() ?? null;
  const companyName = profile?.asaasCompanyName?.trim() ?? null;

  // CPF/CNPJ: prioriza Conta.cpfCnpj (legado), fallback para FinanceProfile.draftCpfCnpj (wizard)
  const cpfCnpj = conta.cpfCnpj ?? profile?.draftCpfCnpj ?? null;

  // Data de nascimento: prioriza Usuario.birthDate, fallback para FinanceProfile.draftBirthDate (wizard)
  const birthDate = fallbackUser.birthDate
    ? toDateOnlyUtcString(fallbackUser.birthDate)
    : profile?.draftBirthDate ?? null;

  const subaccountEmail = resolveCanonicalSubaccountEmail(fallbackUser.email);
  if (!subaccountEmail) {
    return null;
  }

  return {
    ownerName,
    companyName,
    legacyName,
    email: subaccountEmail,
    cpfCnpj,
    birthDate,
  };
}

async function resolveContaAddress(contaId: string): Promise<{
  address: string | null;
  addressNumber: string | null;
  province: string | null;
  postalCode: string | null;
}> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      enderecoLogradouro: true,
      enderecoNumero: true,
      enderecoBairro: true,
      enderecoCep: true,
    },
  });

  return {
    address: conta?.enderecoLogradouro ?? null,
    addressNumber: conta?.enderecoNumero ?? null,
    province: conta?.enderecoBairro ?? null,
    postalCode: conta?.enderecoCep ?? null,
  };
}

function getRequiredOnboardingData(profile: {
  mobilePhone: string | null;
  incomeValue: unknown;
  address: string | null;
  addressNumber: string | null;
  province: string | null;
  postalCode: string | null;
  complement: string | null;
}): {
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  province: string;
  postalCode: string;
  complement?: string;
} {
  const missing: string[] = [];
  if (!profile.mobilePhone) missing.push('mobilePhone');
  if (profile.incomeValue === null || profile.incomeValue === undefined) missing.push('incomeValue');
  if (!profile.address) missing.push('address');
  if (!profile.addressNumber) missing.push('addressNumber');
  if (!profile.province) missing.push('province');
  if (!profile.postalCode) missing.push('postalCode');

  if (missing.length > 0) {
    throw new Error(`Dados obrigatórios ausentes: ${missing.join(', ')}`);
  }

  const rawIncomeValue = profile.incomeValue;
  const incomeValue =
    typeof rawIncomeValue === 'number'
      ? rawIncomeValue
      : typeof rawIncomeValue === 'object' && rawIncomeValue !== null && 'toNumber' in rawIncomeValue
        ? (rawIncomeValue as { toNumber: () => number }).toNumber()
        : NaN;

  if (!Number.isFinite(incomeValue) || incomeValue <= 0) {
    throw new Error('incomeValue inválido');
  }

  return {
    mobilePhone: profile.mobilePhone!,
    incomeValue,
    address: profile.address!,
    addressNumber: profile.addressNumber!,
    province: profile.province!,
    postalCode: profile.postalCode!,
    complement: profile.complement ?? undefined,
  };
}

export type CreateAsaasAccountResult = {
  financeProfileId: string;
  asaasAccountId: string | null;
  status: FinancialOnboardingStatus;
  created: boolean;
  /** Indica se o resultado veio de uma conta já existente (idempotência) */
  idempotent?: boolean;
};

/**
 * Cria ou reaproveita uma subconta Asaas para a instituição.
 *
 * Garantias de idempotência:
 * 1. Verifica se já existe subconta conectada (status em CREATED/UNDER_REVIEW/APPROVED com apiKey válida)
 * 2. Usa advisory lock por financeProfileId para evitar race conditions
 * 3. Após criação, verifica duplicatas e retorna existente se houver
 */
export async function createAsaasAccount(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<CreateAsaasAccountResult> {
  const financeProfile = await financeProfileService.getOrCreateByTenant(params.contaId);
  const lockKey = `create-asaas-account:${financeProfile.id}`;

  // 1) Verificação rápida de idempotência (sem lock)
  const existingConnected = await findExistingConnectedAccount(financeProfile.id);
  if (existingConnected) {
    try {
      await ensureExistingWebhookConfig({
        contaId: params.contaId,
        financeProfileId: financeProfile.id,
        asaasAccountId: existingConnected.asaasAccountId,
        webhookAuthTokenHash: existingConnected.webhookAuthTokenHash,
        actor: params.actor,
      });
    } catch (error) {
      if (isWebhookConfigurationError(error)) throw error;
      // Não bloquear retorno idempotente por falha de reparo do webhook.
    }

    console.info('[finance.createAsaasAccount] Subconta já conectada (idempotente)', {
      contaId: params.contaId,
      financeProfileId: financeProfile.id,
    });

    // AVISO DE DEBUG: Se o usuário reclama que "não criou no Asaas", é provável que
    // exista um registro aqui (banco local) mas não no Asaas (sandbox resetado?).
    if (process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ [finance.createAsaasAccount] Retornando conta existente LOCALMENTE. Verifique se ela existe no painel do Asaas Sandbox!');
    }

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: existingConnected.asaasAccountId,
      status: existingConnected.status,
      created: false,
      idempotent: true,
    };
  }

  // 2) Tentar adquirir lock para evitar criação concorrente
  const lockResult = await withAdvisoryLock(
    lockKey,
    async () => {
      // Re-verificar após adquirir lock (double-check)
      const recheck = await findExistingConnectedAccount(financeProfile.id);
      if (recheck) {
        try {
          await ensureExistingWebhookConfig({
            contaId: params.contaId,
            financeProfileId: financeProfile.id,
            asaasAccountId: recheck.asaasAccountId,
            webhookAuthTokenHash: recheck.webhookAuthTokenHash,
            actor: params.actor,
          });
        } catch (error) {
          if (isWebhookConfigurationError(error)) throw error;
          // Não bloquear retorno idempotente por falha de reparo do webhook.
        }

        return {
          financeProfileId: financeProfile.id,
          asaasAccountId: recheck.asaasAccountId,
          status: recheck.status,
          created: false,
          idempotent: true,
        };
      }

      // Prosseguir com criação
      return createAsaasAccountInternal({ ...params, financeProfile });
    },
    { logContext: { contaId: params.contaId, financeProfileId: financeProfile.id } },
  );

  if (!lockResult.acquired) {
    // Não conseguiu o lock - outra requisição está criando
    // Aguardar brevemente e retornar estado atual
    console.debug('[finance.createAsaasAccount] Lock não adquirido, verificando estado atual', {
      contaId: params.contaId,
      financeProfileId: financeProfile.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterLockCheck = await findExistingAccountSnapshot(financeProfile.id);
    if (afterLockCheck) {
      return {
        financeProfileId: financeProfile.id,
        asaasAccountId: afterLockCheck.asaasAccountId,
        status: afterLockCheck.status,
        created: false,
        idempotent: true,
      };
    }

    // Ainda não existe - pode ser que a outra requisição falhou ou está em progresso
    const placeholder = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true, asaasAccountId: true },
    });

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: placeholder?.asaasAccountId ?? null,
      status: placeholder?.status ?? 'NOT_STARTED',
      created: false,
    };
  }

  return lockResult.result;
}

/**
 * Lógica interna de criação de subconta.
 * Deve ser chamada dentro de um lock.
 */
async function createAsaasAccountInternal(params: {
  contaId: string;
  financeProfile: { id: string };
  actor?: { type: AuditActorType; id?: string };
}): Promise<CreateAsaasAccountResult> {
  const financeProfile = params.financeProfile;

  const existing = await prisma.asaasAccount.findUnique({ where: { financeProfileId: financeProfile.id } });

  if (existing?.asaasAccountId) {
    try {
      await ensureExistingWebhookConfig({
        contaId: params.contaId,
        financeProfileId: financeProfile.id,
        asaasAccountId: existing.asaasAccountId,
        webhookAuthTokenHash: existing.webhookAuthTokenHash,
        actor: params.actor,
      });
    } catch (error) {
      if (isWebhookConfigurationError(error)) throw error;
      // Não falhar onboarding por reparo best-effort do webhook.
    }

    const canUseStoredApiKey = (() => {
      if (!existing.apiKeyEncrypted) return false;
      if (existing.apiKeyStatus === 'CONNECTED') return true;
      return false;
    })();

    if (!canUseStoredApiKey) {
      try {
        const decrypted = existing.apiKeyEncrypted
          ? credentialVault.decrypt(existing.apiKeyEncrypted)
          : null;

        if (decrypted) {
          const status = await validateSubaccountApiKey(decrypted);
          if (status === 'CONNECTED') {
            await prisma.asaasAccount.update({
              where: { id: existing.id },
              data: { apiKeyStatus: status },
              select: { id: true },
            });

            return {
              financeProfileId: financeProfile.id,
              asaasAccountId: existing.asaasAccountId,
              status: existing.status,
              created: false,
            };
          }

          await prisma.asaasAccount.update({
            where: { id: existing.id },
            data: { apiKeyStatus: status },
            select: { id: true },
          });
        }
      } catch {
        // Falha na validação do token antigo - prossegue para criação de um novo.
      }

      const { accessToken, existingAccessTokenCount } = await createProvisioningAccessToken({
        contaId: params.contaId,
        accountId: existing.asaasAccountId,
      });

      const encryptedApiKey = credentialVault.encrypt(accessToken.apiKey);
      const apiKeyStatus = await validateSubaccountApiKey(accessToken.apiKey);

      await prisma.$transaction(async (tx) => {
        await tx.asaasAccount.update({
          where: { id: existing.id },
          data: {
            apiKeyEncrypted: encryptedApiKey,
            apiKeyStatus,
          },
          select: { id: true },
        });

        await tx.asaasCredential.upsert({
          where: { financeProfileId: financeProfile.id },
          create: {
            financeProfileId: financeProfile.id,
            apiKeyEncrypted: encryptedApiKey,
          },
          update: {
            apiKeyEncrypted: encryptedApiKey,
          },
        });

        await auditLogService.record({
          contaId: params.contaId,
          action: 'finance.onboarding.create_subaccount_api_key',
          entity: { type: 'AsaasAccount', id: existing.id },
          metadata: {
            asaasAccountId: existing.asaasAccountId,
            accessTokenId: accessToken.id,
            existingAccessTokenCount,
          },
          actor: params.actor,
        });
      });
    }

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: existing.asaasAccountId,
      status: existing.status,
      created: false,
    };
  }

  const [profileData, contaAddress] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { id: financeProfile.id },
      select: {
        asaasName: true,
        asaasPhone: true,
        asaasSite: true,
        mobilePhone: true,
        incomeValue: true,
        address: true,
        addressNumber: true,
        province: true,
        postalCode: true,
        complement: true,
        companyType: true,
      },
    }),
    resolveContaAddress(params.contaId),
  ]);

  if (!profileData) {
    throw new Error('FinanceProfile não encontrado');
  }

  const mergedAddress = {
    address: contaAddress.address ?? profileData.address,
    addressNumber: contaAddress.addressNumber ?? profileData.addressNumber,
    province: contaAddress.province ?? profileData.province,
    postalCode: contaAddress.postalCode ?? profileData.postalCode,
    complement: profileData.complement,
  };

  const canProvision =
    Boolean(profileData.mobilePhone) &&
    Boolean(mergedAddress.address) &&
    Boolean(mergedAddress.addressNumber) &&
    Boolean(mergedAddress.province) &&
    Boolean(mergedAddress.postalCode) &&
    profileData.incomeValue !== null &&
    profileData.incomeValue !== undefined;

  if (!canProvision) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[finance.createAsaasAccount] Falha em canProvision. Dados faltantes:', {
        mobilePhone: Boolean(profileData.mobilePhone),
        address: Boolean(mergedAddress.address),
        addressNumber: Boolean(mergedAddress.addressNumber),
        province: Boolean(mergedAddress.province),
        postalCode: Boolean(mergedAddress.postalCode),
        incomeValue: profileData.incomeValue !== null && profileData.incomeValue !== undefined,
      });
    }

    const placeholder = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true },
    });

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: null,
      status: placeholder?.status ?? 'NOT_STARTED',
      created: false,
    };
  }

  const required = getRequiredOnboardingData({
    mobilePhone: profileData.mobilePhone,
    incomeValue: profileData.incomeValue,
    address: mergedAddress.address,
    addressNumber: mergedAddress.addressNumber,
    province: mergedAddress.province,
    postalCode: mergedAddress.postalCode,
    complement: mergedAddress.complement,
  });

  const identity = await tryResolveContaIdentity(params.contaId, financeProfile.id);

  if (!identity) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[finance.createAsaasAccount] Falha em identity. Usuário dono não encontrado ou sem email.', {
        contaId: params.contaId,
        financeProfileId: financeProfile.id,
      });
    }

    const placeholder = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true },
    });

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: null,
      status: placeholder?.status ?? 'NOT_STARTED',
      created: false,
    };
  }

  if (!identity.cpfCnpj) {
    // Should be handled by onboarding UI requiring CPF/CNPJ update before provisioning
    throw new Error('CPF/CNPJ é obrigatório para criar subconta Asaas.');
  }

  const externalReference = financeProfileExternalReference(financeProfile.id);
  const webhookUrl = resolveWebhookUrlOrNull();
  if (!webhookUrl) {
    throw new Error(
      'ASAAS_WEBHOOK_PUBLIC_BASE_URL ou NEXT_PUBLIC_APP_URL deve apontar para uma URL pública https para configurar o webhook do Asaas.',
    );
  }

  const expectedWebhookConfig = buildExpectedWebhookConfig(financeProfile.id, webhookUrl);
  const webhookAuthToken = expectedWebhookConfig.authToken;
  const webhookAuthTokenHash = expectedWebhookConfig.authTokenHash;

  const cpfCnpj = normalizeCpfCnpj(identity.cpfCnpj);
  const personType = detectPersonType(cpfCnpj);
  const subaccountName =
    personType === 'PJ'
      ? identity.companyName?.trim() || identity.legacyName?.trim() || identity.ownerName
      : identity.ownerName;

  if (personType === 'PF' && !identity.birthDate) {
    throw new MissingBirthDateError();
  }

  const companyType = personType === 'PJ' ? normalizeCompanyType(profileData.companyType) : undefined;
  if (personType === 'PJ' && !companyType) {
    throw new MissingCompanyTypeError();
  }

  const phone = profileData.asaasPhone?.trim() ? profileData.asaasPhone.trim() : undefined;

  const createAccountPayload = createAsaasAccountSchema.parse({
    name: subaccountName,
    email: identity.email,
    cpfCnpj,
    birthDate: personType === 'PF' ? identity.birthDate : undefined,
    companyType: personType === 'PJ' ? companyType : undefined,
    phone,
    mobilePhone: normalizeMobilePhone(required.mobilePhone),
    incomeValue: required.incomeValue,
    address: required.address,
    addressNumber: required.addressNumber,
    province: required.province,
    postalCode: required.postalCode,
    complement: required.complement,
  });

  const createSubaccountPayload = {
    name: createAccountPayload.name,
    email: createAccountPayload.email,
    cpfCnpj: createAccountPayload.cpfCnpj,
    ...(personType === 'PF' && createAccountPayload.birthDate ? { birthDate: createAccountPayload.birthDate } : {}),
    ...(personType === 'PJ' && createAccountPayload.companyType ? { companyType: createAccountPayload.companyType } : {}),
    ...(createAccountPayload.phone ? { phone: createAccountPayload.phone } : {}),
    mobilePhone: createAccountPayload.mobilePhone,
    incomeValue: createAccountPayload.incomeValue,
    address: createAccountPayload.address,
    addressNumber: createAccountPayload.addressNumber,
    province: createAccountPayload.province,
    postalCode: createAccountPayload.postalCode,
    complement: createAccountPayload.complement,
    externalReference,
    webhooks: [
      {
        name: RECOMMENDED_WEBHOOK_NAME,
        url: webhookUrl,
        email: identity.email,
        sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
        interrupted: false,
        enabled: true,
        apiVersion: 3,
        authToken: webhookAuthToken,
        events: expectedWebhookConfig.events,
      },
    ],
  };

  const recoveredBeforeCreate = await tryRecoverExistingRemoteSubaccount({
    contaId: params.contaId,
    financeProfileId: financeProfile.id,
    identity,
    externalReference,
    webhookAuthTokenHash,
    actor: params.actor,
    recoveryReason: 'PRE_CREATE_RECONCILIATION',
    created: false,
    idempotent: true,
  });

  if (recoveredBeforeCreate) {
    return recoveredBeforeCreate;
  }

  // Atualizar contagem de tentativas
  if (existing) {
    await prisma.asaasAccount.update({
      where: { financeProfileId: financeProfile.id },
      data: {
        provisionAttempts: { increment: 1 },
        provisionLastAttemptAt: new Date(),
      },
      select: { id: true },
    });
  }

  let subaccount: Awaited<ReturnType<typeof createSubaccount>>;
  try {
    subaccount = await createSubaccount({
      apiKey: getMasterAsaasApiKey(),
      idempotencyKey: externalReference,
      data: createSubaccountPayload,
    });
  } catch (error) {
    const errorInfo = extractErrorInfo(error);

    // Registrar erro (sem dados sensíveis)
    if (existing) {
      await prisma.asaasAccount.update({
        where: { financeProfileId: financeProfile.id },
        data: {
          provisionLastError: errorInfo.message.slice(0, 500),
          provisionLastHttpStatus: errorInfo.status ?? null,
        },
        select: { id: true },
      });
    }

    // Erros específicos do sandbox
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AsaasHttpError' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      const msg = (error as { message: string }).message.toLowerCase();
      if (msg.includes('sandbox') && (msg.includes('20 subcontas') || msg.includes('limite'))) {
        throw new AsaasSandboxSubaccountDailyLimitError();
      }
    }

    const shouldTryRemoteRecovery = isNonDeterministicError(error) || errorInfo.status === 409;

    // Recovery: reconciliar subconta remota quando a criação pode ter acontecido
    // ou quando o provedor informa conflito por conta já existente.
    if (shouldTryRemoteRecovery) {
      console.warn('[finance.createAsaasAccount] Tentando reconciliar subconta remota após falha de criação', {
        contaId: params.contaId,
        financeProfileId: financeProfile.id,
        errorCode: errorInfo.code,
        httpStatus: errorInfo.status,
      });

      try {
        const recovered = await tryRecoverExistingRemoteSubaccount({
          contaId: params.contaId,
          financeProfileId: financeProfile.id,
          identity,
          externalReference,
          webhookAuthTokenHash,
          actor: params.actor,
          recoveryReason: errorInfo.status === 409 ? 'POST_CREATE_CONFLICT' : 'POST_CREATE_TIMEOUT',
          created: errorInfo.status === 409 ? false : true,
          idempotent: errorInfo.status === 409,
        });

        if (recovered) {
          return recovered;
        }
      } catch (recoveryError) {
        // Recovery falhou, propagar erro original
        console.error('[finance.createAsaasAccount] Falha no recovery', {
          contaId: params.contaId,
          recoveryError: extractErrorInfo(recoveryError).message,
        });
      }
    }

    throw error;
  }

  const encryptedApiKey = credentialVault.encrypt(subaccount.apiKey);
  const apiKeyStatus = await validateSubaccountApiKey(subaccount.apiKey);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const asaasAccount = await tx.asaasAccount.upsert({
        where: { financeProfileId: financeProfile.id },
        create: {
          financeProfileId: financeProfile.id,
          asaasAccountId: subaccount.id,
          asaasAccountEmail: subaccount.email ?? identity.email,
          externalReference,
          status: 'CREATED',
          statusUpdatedAt: now,
          provisionedAt: now,
          apiKeyEncrypted: encryptedApiKey,
          apiKeyStatus,
          documentsCache: Prisma.DbNull,
          documentsCacheUpdatedAt: null,
          webhookAuthTokenHash,
          provisionLastError: null, // Limpar erro após sucesso
        },
        update: {
          asaasAccountId: subaccount.id,
          asaasAccountEmail: subaccount.email ?? identity.email,
          externalReference,
          status: 'CREATED',
          statusUpdatedAt: now,
          provisionedAt: { set: now },
          apiKeyEncrypted: encryptedApiKey,
          apiKeyStatus,
          documentsCache: Prisma.DbNull,
          documentsCacheUpdatedAt: null,
          webhookAuthTokenHash,
          provisionLastError: null, // Limpar erro após sucesso
        },
      });

      await tx.financeProfile.update({
        where: { id: financeProfile.id },
        data: { asaasAccountId: subaccount.id },
        select: { id: true },
      });

      await tx.asaasCredential.createMany({
        data: [{ financeProfileId: financeProfile.id, apiKeyEncrypted: encryptedApiKey }],
        skipDuplicates: true,
      });

      await auditLogService.record({
        contaId: params.contaId,
        action: 'finance.onboarding.create_subaccount',
        entity: { type: 'AsaasAccount', id: asaasAccount.id },
        metadata: { asaasAccountId: subaccount.id, externalReference },
        actor: params.actor,
      });

      return asaasAccount;
    });

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: created.asaasAccountId,
      status: created.status,
      created: true,
    };
  } catch (error) {
    const alreadyCreated = await prisma.asaasAccount.findUnique({ where: { financeProfileId: financeProfile.id } });
    if (alreadyCreated?.asaasAccountId) {
      return {
        financeProfileId: financeProfile.id,
        asaasAccountId: alreadyCreated.asaasAccountId,
        status: alreadyCreated.status,
        created: false,
      };
    }
    throw error;
  }
}
