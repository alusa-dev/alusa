import {
  createWebhook,
  getMyAccountCommercialInfo,
  getMyAccountStatus,
  listWebhooks,
  updateWebhook,
} from '@alusa/asaas';
import { prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';

import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { auditLogService } from '../../foundation/audit-log.service';
import { credentialVault } from '../../foundation/credential-vault';
import { financeProfileService } from '../../foundation/finance-profile.service';
import {
  buildExpectedWebhookConfig,
  hasSameWebhookEvents,
  normalizeWebhookUrlBase,
} from '../asaas-account/expected-webhook-config.server';

type ExternalWebhookAction = 'created' | 'updated' | 'unchanged' | 'pending';

export type ConnectExternalAsaasAccountResult =
  | {
      success: true;
      summary: string;
      status: 'READY' | 'WEBHOOK_PENDING';
      webhookAction: ExternalWebhookAction;
      account: {
        asaasAccountId: string;
        asaasEmail: string | null;
      };
    }
  | {
      success: false;
      summary: string;
      status: 'FAILED';
      errorCode: 'INVALID_API_KEY' | 'UNEXPECTED_ERROR';
    };

function normalizeDigits(value: string | undefined): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits ? digits : null;
}

function resolveCompanyName(schoolName: string, cpfCnpj: string | null): string | null {
  return cpfCnpj?.length === 14 ? schoolName : null;
}

async function upsertLocalExternalConnection(params: {
  contaId: string;
  financeProfileId: string;
  schoolName: string;
  cpfCnpj: string | null;
  phone: string | null;
  apiKeyEncrypted: string;
  asaasAccountId: string;
  asaasEmail: string | null;
  webhookAuthTokenHash?: string;
  actor: { id?: string | null; type: AuditActorType };
  onboardingStatus: 'READY' | 'WEBHOOK_PENDING';
  webhookAction: ExternalWebhookAction;
}) {
  const now = new Date();
  const existingAsaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: params.financeProfileId },
    select: {
      id: true,
      status: true,
      externalReference: true,
      webhookAuthTokenHash: true,
      provisionedAt: true,
    },
  });

  const desiredExternalReference = `financeProfile:${params.financeProfileId}`;
  const externalReferenceConflict = await prisma.asaasAccount.findUnique({
    where: { externalReference: desiredExternalReference },
    select: { id: true },
  });
  const canSetExternalReference =
    !externalReferenceConflict || externalReferenceConflict.id === existingAsaasAccount?.id;

  const oldStatus = existingAsaasAccount?.status ?? null;
  const nextStatus: FinancialOnboardingStatus = 'APPROVED';
  const nextWebhookHash = params.webhookAuthTokenHash ?? existingAsaasAccount?.webhookAuthTokenHash ?? undefined;

  const profileCompanyName = resolveCompanyName(params.schoolName, params.cpfCnpj);

  const upserted = await prisma.$transaction(async (tx) => {
    await tx.conta.update({
      where: { id: params.contaId },
      data: {
        nome: params.schoolName,
        cpfCnpj: params.cpfCnpj,
        financeStatus: params.onboardingStatus === 'READY' ? 'FINANCE_APPROVED' : 'FINANCE_ONBOARDING_STARTED',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        externalAsaasOnboardingStatus: params.onboardingStatus,
      },
      select: { id: true },
    });

    await tx.financeProfile.update({
      where: { id: params.financeProfileId },
      data: {
        asaasAccountId: params.asaasAccountId,
        status: 'APPROVED',
        isOnboardingCompleted: true,
        onboardingCompletedAt: now,
        lastAsaasSyncAt: now,
        asaasName: params.schoolName,
        asaasOwnerName: params.schoolName,
        asaasCompanyName: profileCompanyName,
        asaasLoginEmail: params.asaasEmail,
        mobilePhone: params.phone,
      },
      select: { id: true },
    });

    const asaasAccount = await tx.asaasAccount.upsert({
      where: { financeProfileId: params.financeProfileId },
      create: {
        financeProfileId: params.financeProfileId,
        asaasAccountId: params.asaasAccountId,
        status: nextStatus,
        statusUpdatedAt: now,
        provisionedAt: now,
        apiKeyEncrypted: params.apiKeyEncrypted,
        apiKeyStatus: 'CONNECTED',
        asaasAccountEmail: params.asaasEmail,
        webhookAuthTokenHash: nextWebhookHash,
        ...(canSetExternalReference ? { externalReference: desiredExternalReference } : {}),
      },
      update: {
        asaasAccountId: params.asaasAccountId,
        status: nextStatus,
        statusUpdatedAt: now,
        provisionedAt: existingAsaasAccount?.provisionedAt ?? now,
        apiKeyEncrypted: params.apiKeyEncrypted,
        apiKeyStatus: 'CONNECTED',
        asaasAccountEmail: params.asaasEmail,
        webhookAuthTokenHash: nextWebhookHash,
        ...(canSetExternalReference ? { externalReference: desiredExternalReference } : {}),
      },
      select: { id: true },
    });

    await tx.asaasCredential.upsert({
      where: { financeProfileId: params.financeProfileId },
      create: {
        financeProfileId: params.financeProfileId,
        apiKeyEncrypted: params.apiKeyEncrypted,
      },
      update: {
        apiKeyEncrypted: params.apiKeyEncrypted,
      },
      select: { id: true },
    });

    if (oldStatus !== nextStatus) {
      await tx.asaasAccountStatusHistory.create({
        data: {
          asaasAccountId: asaasAccount.id,
          oldStatus,
          newStatus: nextStatus,
          event: 'EXTERNAL_ONBOARDING_CONNECTED',
          payloadId: `asaasAccount:${params.asaasAccountId}`,
        },
        select: { id: true },
      });
    }

    return asaasAccount;
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.external-asaas.connected',
    entity: { type: 'AsaasAccount', id: upserted.id },
    metadata: {
      asaasAccountId: params.asaasAccountId,
      asaasEmail: params.asaasEmail,
      onboardingStatus: params.onboardingStatus,
      webhookAction: params.webhookAction,
    },
    actor: params.actor.id ? { ...params.actor, id: params.actor.id } : { type: params.actor.type },
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

  let myAccountStatus;
  try {
    myAccountStatus = await getMyAccountStatus({ apiKey });
  } catch (error) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');
    if (failure.category === 'invalid_subaccount_credentials') {
      await prisma.conta.update({
        where: { id: input.contaId },
        data: {
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          financeStatus: 'FINANCE_ONBOARDING_STARTED',
          externalAsaasOnboardingStatus: 'FAILED',
        },
        select: { id: true },
      });

      return {
        success: false,
        summary: 'API key inválida ou sem permissão para acessar a conta do Asaas.',
        status: 'FAILED',
        errorCode: 'INVALID_API_KEY',
      };
    }

    return {
      success: false,
      summary: 'Não foi possível validar a conta do Asaas agora.',
      status: 'FAILED',
      errorCode: 'UNEXPECTED_ERROR',
    };
  }

  const asaasAccountId = typeof myAccountStatus?.id === 'string' ? myAccountStatus.id.trim() : '';

  if (!asaasAccountId) {
    return {
      success: false,
      summary: 'A conta do Asaas retornou um identificador inválido.',
      status: 'FAILED',
      errorCode: 'UNEXPECTED_ERROR',
    };
  }

  let asaasEmail: string | null = null;

  try {
    const commercialInfo = await getMyAccountCommercialInfo({ apiKey });
    asaasEmail = typeof commercialInfo?.email === 'string' ? commercialInfo.email.trim() || null : null;
  } catch (error) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');

    if (failure.category === 'invalid_subaccount_credentials') {
      await prisma.conta.update({
        where: { id: input.contaId },
        data: {
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          financeStatus: 'FINANCE_ONBOARDING_STARTED',
          externalAsaasOnboardingStatus: 'FAILED',
        },
        select: { id: true },
      });

      return {
        success: false,
        summary: 'API key inválida ou sem permissão para acessar a conta do Asaas.',
        status: 'FAILED',
        errorCode: 'INVALID_API_KEY',
      };
    }
  }

  const financeProfile = await financeProfileService.getOrCreateByTenant(input.contaId);
  const expectedWebhook = (() => {
    try {
      return buildExpectedWebhookConfig(financeProfile.id);
    } catch {
      return null;
    }
  })();

  let webhookAction: ExternalWebhookAction = 'pending';
  let onboardingStatus: 'READY' | 'WEBHOOK_PENDING' = 'WEBHOOK_PENDING';
  let webhookAuthTokenHash: string | undefined;

  if (expectedWebhook) {
    try {
      const webhookList = await listWebhooks({ apiKey, limit: 100, offset: 0 });
      const matchedWebhook = (webhookList.data ?? []).find(
        (item) => normalizeWebhookUrlBase(item.url) === expectedWebhook.normalizedUrl,
      );

      if (!matchedWebhook) {
        await createWebhook({
          apiKey,
          data: {
            name: expectedWebhook.name,
            url: expectedWebhook.url,
            enabled: true,
            interrupted: false,
            authToken: expectedWebhook.authToken,
            sendType: expectedWebhook.sendType,
            events: expectedWebhook.events,
          },
        });
        webhookAction = 'created';
      } else {
        const needsUpdate =
          matchedWebhook.enabled === false ||
          matchedWebhook.interrupted === true ||
          matchedWebhook.name !== expectedWebhook.name ||
          matchedWebhook.sendType !== expectedWebhook.sendType ||
          matchedWebhook.hasAuthToken !== true ||
          !hasSameWebhookEvents(matchedWebhook.events, expectedWebhook.events);

        if (needsUpdate) {
          await updateWebhook({
            apiKey,
            webhookId: matchedWebhook.id,
            data: {
              name: expectedWebhook.name,
              url: expectedWebhook.url,
              enabled: true,
              interrupted: false,
              authToken: expectedWebhook.authToken,
              sendType: expectedWebhook.sendType,
              events: expectedWebhook.events,
            },
          });
          webhookAction = 'updated';
        } else {
          webhookAction = 'unchanged';
        }
      }

      onboardingStatus = 'READY';
      webhookAuthTokenHash = expectedWebhook.authTokenHash;
    } catch {
      webhookAction = 'pending';
      onboardingStatus = 'WEBHOOK_PENDING';
    }
  }

  const apiKeyEncrypted = credentialVault.encrypt(apiKey);

  await upsertLocalExternalConnection({
    contaId: input.contaId,
    financeProfileId: financeProfile.id,
    schoolName,
    cpfCnpj,
    phone,
    apiKeyEncrypted,
    asaasAccountId,
    asaasEmail,
    webhookAuthTokenHash,
    actor: input.actor,
    onboardingStatus,
    webhookAction,
  });

  return {
    success: true,
    summary:
      onboardingStatus === 'READY'
        ? 'Conta do Asaas conectada e webhook validado com sucesso.'
        : 'Conta do Asaas conectada, mas o webhook ainda precisa ser concluído.',
    status: onboardingStatus,
    webhookAction,
    account: {
      asaasAccountId,
      asaasEmail,
    },
  };
}