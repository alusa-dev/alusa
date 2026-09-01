import {
  getMyAccountCommercialInfo,
  getMyAccountDocuments,
  getMyAccountStatus,
} from '@alusa/asaas';
import { prisma } from '@alusa/database';
import type {
  AuditActorType,
  FinanceProfileRegulatoryStatus,
  FinanceStatus,
  FinancialOnboardingStatus,
} from '@prisma/client';

import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { auditLogService } from '../../foundation/audit-log.service';
import { credentialVault } from '../../foundation/credential-vault';
import { financeProfileService } from '../../foundation/finance-profile.service';
import {
  AsaasWebhookConfigurationError,
  ensureAsaasWebhookConfiguration,
  type EnsureAsaasWebhookAction,
} from '../../webhooks/ensure-asaas-webhook-configuration';
import { buildCacheV2 } from '../kyc/kyc-cache-utils';
import { syncKycModels } from '../kyc/kyc-persistence.service';

export type ConnectExternalAsaasAccountErrorCode =
  | 'INVALID_API_KEY'
  | 'ACCOUNT_ALREADY_LINKED'
  | 'WEBHOOK_CONFIGURATION_INVALID'
  | 'WEBHOOK_LIMIT_REACHED'
  | 'PROVISIONING_IN_PROGRESS'
  | 'UNSUPPORTED_FEATURE'
  | 'TEMPORARY_ASAAS_ERROR'
  | 'UNEXPECTED_ERROR';

export type ConnectExternalAsaasAccountResult =
  | {
      success: true;
      summary: string;
      status: 'READY';
      webhookAction: EnsureAsaasWebhookAction;
      account: {
        asaasAccountId: string;
        asaasEmail: string | null;
      };
    }
  | {
      success: false;
      summary: string;
      status: 'FAILED';
      errorCode: ConnectExternalAsaasAccountErrorCode;
      retryable?: boolean;
    };

function normalizeDigits(value: string | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits ? digits : null;
}

function resolveCompanyName(schoolName: string, cpfCnpj: string | null): string | null {
  return cpfCnpj?.length === 14 ? schoolName : null;
}

function mapRegulatoryStatus(value: unknown): {
  onboarding: FinancialOnboardingStatus;
  finance: FinanceStatus;
  profile: FinanceProfileRegulatoryStatus;
  operational: 'OPERATIONAL' | 'KYC_PENDING' | 'REJECTED';
} {
  switch (value) {
    case 'APPROVED':
      return {
        onboarding: 'APPROVED',
        finance: 'FINANCE_APPROVED',
        profile: 'APPROVED',
        operational: 'OPERATIONAL',
      };
    case 'REJECTED':
      return {
        onboarding: 'REJECTED',
        finance: 'FINANCE_REJECTED',
        profile: 'REJECTED',
        operational: 'REJECTED',
      };
    case 'PENDING':
    case 'AWAITING_APPROVAL':
    default:
      return {
        onboarding: 'UNDER_REVIEW',
        finance: 'FINANCE_IN_ANALYSIS',
        profile: 'PENDING',
        operational: 'KYC_PENDING',
      };
  }
}

function mapWebhookFailure(error: unknown): {
  errorCode: ConnectExternalAsaasAccountErrorCode;
  summary: string;
  retryable: boolean;
} {
  if (error instanceof AsaasWebhookConfigurationError) {
    switch (error.code) {
      case 'CONFIGURATION_INVALID':
        return {
          errorCode: 'WEBHOOK_CONFIGURATION_INVALID',
          summary: error.message,
          retryable: false,
        };
      case 'WEBHOOK_LIMIT_REACHED':
        return {
          errorCode: 'WEBHOOK_LIMIT_REACHED',
          summary: error.message,
          retryable: false,
        };
      case 'PROVISIONING_IN_PROGRESS':
        return {
          errorCode: 'PROVISIONING_IN_PROGRESS',
          summary: error.message,
          retryable: true,
        };
      default:
        break;
    }
  }

  const failure = classifyAsaasOperationalError(error, 'subaccount');
  if (failure.category === 'invalid_subaccount_credentials') {
    return {
      errorCode: 'INVALID_API_KEY',
      summary: 'API key inválida, expirada, desabilitada ou sem permissão no Asaas.',
      retryable: false,
    };
  }
  if (failure.category === 'unsupported_feature') {
    return {
      errorCode: 'UNSUPPORTED_FEATURE',
      summary: 'A conta Asaas não possui o recurso solicitado habilitado ou elegível.',
      retryable: false,
    };
  }
  if (failure.retryable) {
    return {
      errorCode: 'TEMPORARY_ASAAS_ERROR',
      summary: 'O Asaas está temporariamente indisponível. Tente novamente em alguns instantes.',
      retryable: true,
    };
  }
  return {
    errorCode: 'UNEXPECTED_ERROR',
    summary: 'Não foi possível concluir a configuração automática do webhook do Asaas.',
    retryable: false,
  };
}

async function markConnectionFailure(params: {
  contaId: string;
  financeProfileId?: string;
  preserveExistingConnection: boolean;
  errorCode: ConnectExternalAsaasAccountErrorCode;
  stage?: string;
}): Promise<void> {
  if (params.preserveExistingConnection) return;

  await prisma.$transaction(async (tx) => {
    await tx.conta.update({
      where: { id: params.contaId },
      data: {
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        financeStatus: 'FINANCE_ONBOARDING_STARTED',
        externalAsaasOnboardingStatus: 'FAILED',
      },
      select: { id: true },
    });

    if (params.financeProfileId) {
      await tx.asaasAccount.updateMany({
        where: { financeProfileId: params.financeProfileId },
        data: {
          webhookStatus:
            params.errorCode === 'WEBHOOK_CONFIGURATION_INVALID' ? 'INVALID_URL' : 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
          provisionLastStage: params.stage ?? 'EXTERNAL_WEBHOOK_FAILED',
          provisionLastError: params.errorCode,
        },
      });
    }
  });
}

export async function connectExternalAsaasAccount(input: {
  contaId: string;
  schoolName: string;
  cpfCnpj?: string | null;
  phone?: string | null;
  apiKey: string;
  actor: { id?: string | null; type: AuditActorType };
}): Promise<ConnectExternalAsaasAccountResult> {
  const apiKey = input.apiKey.trim();
  const schoolName = input.schoolName.trim();
  const cpfCnpj = normalizeDigits(input.cpfCnpj ?? undefined);
  const phone = normalizeDigits(input.phone ?? undefined);

  if (apiKey.length < 10 || schoolName.length < 2) {
    return {
      success: false,
      summary: 'Dados inválidos para conectar a conta do Asaas.',
      status: 'FAILED',
      errorCode: 'INVALID_API_KEY',
    };
  }

  let myAccountStatus: Awaited<ReturnType<typeof getMyAccountStatus>>;
  try {
    myAccountStatus = await getMyAccountStatus({ apiKey });
  } catch (error) {
    const mapped = mapWebhookFailure(error);
    return { success: false, status: 'FAILED', ...mapped };
  }

  const asaasAccountId = typeof myAccountStatus?.id === 'string' ? myAccountStatus.id.trim() : '';
  if (!asaasAccountId) {
    return {
      success: false,
      summary: 'A conta do Asaas não retornou um identificador válido.',
      status: 'FAILED',
      errorCode: 'UNEXPECTED_ERROR',
    };
  }

  let commercialInfo: Awaited<ReturnType<typeof getMyAccountCommercialInfo>> | null = null;
  try {
    commercialInfo = await getMyAccountCommercialInfo({ apiKey });
  } catch (error) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');
    if (failure.category === 'invalid_subaccount_credentials') {
      return {
        success: false,
        summary: 'API key inválida ou sem permissão para acessar a conta do Asaas.',
        status: 'FAILED',
        errorCode: 'INVALID_API_KEY',
      };
    }
  }

  const asaasEmail =
    typeof commercialInfo?.email === 'string' ? commercialInfo.email.trim() || null : null;
  const regulatory = mapRegulatoryStatus(myAccountStatus.general);
  const financeProfile = await financeProfileService.getOrCreateByTenant(input.contaId);

  const [currentAccount, existingByAsaasAccountId] = await Promise.all([
    prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: {
        id: true,
        asaasAccountId: true,
        apiKeyEncrypted: true,
        apiKeyStatus: true,
        status: true,
        provisionedAt: true,
        webhookStatus: true,
        operationalStatus: true,
      },
    }),
    prisma.asaasAccount.findUnique({
      where: { asaasAccountId },
      select: {
        id: true,
        financeProfileId: true,
        financeProfile: { select: { contaId: true } },
      },
    }),
  ]);

  if (existingByAsaasAccountId && existingByAsaasAccountId.financeProfileId !== financeProfile.id) {
    return {
      success: false,
      summary: 'Esta conta Asaas já está vinculada a outra conta da Alusa.',
      status: 'FAILED',
      errorCode: 'ACCOUNT_ALREADY_LINKED',
    };
  }

  const preserveExistingConnection = Boolean(
    currentAccount?.apiKeyEncrypted && currentAccount.apiKeyStatus === 'CONNECTED',
  );
  const replacedExistingAccount = Boolean(
    currentAccount?.asaasAccountId && currentAccount.asaasAccountId !== asaasAccountId,
  );
  const desiredExternalReference = `financeProfile:${financeProfile.id}`;

  // For a first connection, create the local placeholder before provisioning
  // the webhook. When replacing a stale or existing connection, leave the
  // current row untouched until the remote webhook is verified; otherwise a
  // failed replacement could leave the tenant pointing at a new account while
  // still holding the old credential.
  if (!currentAccount) {
    try {
      await prisma.asaasAccount.upsert({
        where: { financeProfileId: financeProfile.id },
        create: {
          financeProfileId: financeProfile.id,
          asaasAccountId,
          asaasAccountEmail: asaasEmail,
          externalReference: desiredExternalReference,
          status: regulatory.onboarding,
          statusUpdatedAt: new Date(),
          provisionedAt: new Date(),
          apiKeyStatus: 'MISSING',
          webhookStatus: 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
          provisionLastStage: 'EXTERNAL_CONFIGURE_WEBHOOK',
        },
        update: {
          asaasAccountId,
          asaasAccountEmail: asaasEmail ?? undefined,
          externalReference: desiredExternalReference,
          status: regulatory.onboarding,
          statusUpdatedAt: new Date(),
          provisionedAt: new Date(),
          provisionLastStage: 'EXTERNAL_CONFIGURE_WEBHOOK',
          webhookStatus: 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
        },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        return {
          success: false,
          summary: 'Esta conta Asaas já está vinculada a outra conta da Alusa.',
          status: 'FAILED',
          errorCode: 'ACCOUNT_ALREADY_LINKED',
        };
      }
      throw error;
    }
  }

  let webhook: Awaited<ReturnType<typeof ensureAsaasWebhookConfiguration>>;
  try {
    webhook = await ensureAsaasWebhookConfiguration({
      contaId: input.contaId,
      financeProfileId: financeProfile.id,
      apiKey,
      notificationEmail: asaasEmail,
      actor: input.actor.id
        ? { type: input.actor.type, id: input.actor.id }
        : { type: input.actor.type },
      persistResult: false,
      persistFailure: false,
      forceAuthTokenRefresh: true,
    });
  } catch (error) {
    const mapped = mapWebhookFailure(error);
    await markConnectionFailure({
      contaId: input.contaId,
      financeProfileId: financeProfile.id,
      preserveExistingConnection,
      errorCode: mapped.errorCode,
      stage:
        error instanceof AsaasWebhookConfigurationError
          ? `EXTERNAL_WEBHOOK_${error.stage}`
          : 'EXTERNAL_WEBHOOK_REMOTE',
    });

    await auditLogService.record({
      contaId: input.contaId,
      action: 'finance.external-asaas.connection_failed',
      entity: { type: 'AsaasAccount', id: currentAccount?.id ?? asaasAccountId },
      metadata: {
        asaasAccountId,
        errorCode: mapped.errorCode,
        retryable: mapped.retryable,
        preservedExistingConnection: preserveExistingConnection,
      },
      actor: input.actor.id
        ? { type: input.actor.type, id: input.actor.id }
        : { type: input.actor.type },
    });

    return { success: false, status: 'FAILED', ...mapped };
  }

  let apiKeyEncrypted: string;
  try {
    apiKeyEncrypted = credentialVault.encrypt(apiKey);
    credentialVault.verifyRoundTrip(apiKeyEncrypted, apiKey);
  } catch {
    return {
      success: false,
      summary: 'A chave foi validada, mas não pôde ser armazenada com segurança neste ambiente.',
      status: 'FAILED',
      errorCode: 'UNEXPECTED_ERROR',
    };
  }
  const now = new Date();
  const oldStatus = currentAccount?.status ?? null;
  const profileCompanyName = resolveCompanyName(schoolName, cpfCnpj);

  // O primeiro vínculo precisa deixar também o read model KYC coerente.
  // Sem essa leitura, a conta fica com status regulatório aprovado, mas com
  // cache/documentos antigos ou ausentes até alguma tela disparar uma
  // reconciliação posterior.
  let documents: Awaited<ReturnType<typeof getMyAccountDocuments>> | null = null;
  try {
    documents = await getMyAccountDocuments({ apiKey });
  } catch (error) {
    // A conexão da API/webhook já foi validada. Se o endpoint de documentos
    // estiver temporariamente indisponível, o snapshot fresh fará retry depois.
    console.warn('[connectExternalAsaasAccount] Falha ao sincronizar documentos iniciais', {
      contaId: input.contaId,
      asaasAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const documentsCache = documents
    ? buildCacheV2({
        myAccountStatus,
        documents,
        fetchedAt: now.toISOString(),
      })
    : null;

  const persisted = await prisma.$transaction(async (tx) => {
    await tx.conta.update({
      where: { id: input.contaId },
      data: {
        nome: schoolName,
        cpfCnpj,
        financeStatus: regulatory.finance,
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        externalAsaasOnboardingStatus: 'READY',
      },
      select: { id: true },
    });

    await tx.financeProfile.update({
      where: { id: financeProfile.id },
      data: {
        asaasAccountId,
        status: regulatory.profile,
        isOnboardingCompleted: true,
        onboardingCompletedAt: now,
        lastAsaasSyncAt: now,
        asaasName: schoolName,
        asaasOwnerName: schoolName,
        asaasCompanyName: profileCompanyName,
        asaasLoginEmail: asaasEmail,
        mobilePhone: phone,
      },
      select: { id: true },
    });

    const asaasAccount = await tx.asaasAccount.update({
      where: { financeProfileId: financeProfile.id },
      data: {
        asaasAccountId,
        status: regulatory.onboarding,
        statusUpdatedAt: now,
        apiKeyEncrypted,
        apiKeyStatus: 'CONNECTED',
        webhookId: webhook.webhookId,
        webhookStatus: 'ACTIVE',
        operationalStatus: regulatory.operational,
        asaasAccountEmail: asaasEmail,
        webhookAuthTokenHash: webhook.authTokenHash,
        previousWebhookAuthTokenHash: null,
        previousWebhookAuthTokenExpiresAt: null,
        lastWebhookCheckAt: now,
        lastApiKeyCheckAt: now,
        lastHealthCheckAt: now,
        provisionLastStage: 'EXTERNAL_READY',
        provisionLastError: null,
        ...(documentsCache
          ? { documentsCache: documentsCache as unknown as object, documentsCacheUpdatedAt: now }
          : {}),
      },
      select: { id: true },
    });

    await tx.asaasCredential.upsert({
      where: { financeProfileId: financeProfile.id },
      create: { financeProfileId: financeProfile.id, apiKeyEncrypted },
      update: { apiKeyEncrypted },
      select: { id: true },
    });

    if (oldStatus !== regulatory.onboarding) {
      await tx.asaasAccountStatusHistory.create({
        data: {
          asaasAccountId: asaasAccount.id,
          oldStatus,
          newStatus: regulatory.onboarding,
          event: 'EXTERNAL_ONBOARDING_CONNECTED',
          payloadId: `asaasAccount:${asaasAccountId}`,
        },
        select: { id: true },
      });
    }

    return asaasAccount;
  });

  if (documents) {
    await syncKycModels({
      asaasAccountId: persisted.id,
      myAccountStatus,
      documents,
      source: 'READ_MODEL',
    }).catch((error) => {
      console.warn('[connectExternalAsaasAccount] Falha ao persistir modelos KYC iniciais', {
        contaId: input.contaId,
        asaasAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  await auditLogService.record({
    contaId: input.contaId,
    action: replacedExistingAccount
      ? 'finance.external-asaas.account_replaced'
      : preserveExistingConnection
        ? 'finance.external-asaas.credential_replaced'
        : 'finance.external-asaas.connected',
    entity: { type: 'AsaasAccount', id: persisted.id },
    metadata: {
      asaasAccountId,
      previousAsaasAccountId: replacedExistingAccount ? currentAccount?.asaasAccountId : null,
      asaasEmail,
      webhookId: webhook.webhookId,
      webhookAction: webhook.action,
      eventsCount: webhook.eventsCount,
      regulatoryStatus: regulatory.onboarding,
    },
    actor: input.actor.id
      ? { type: input.actor.type, id: input.actor.id }
      : { type: input.actor.type },
  });

  return {
    success: true,
    summary: 'Conta do Asaas conectada e webhook configurado com sucesso.',
    status: 'READY',
    webhookAction: webhook.action,
    account: { asaasAccountId, asaasEmail },
  };
}
