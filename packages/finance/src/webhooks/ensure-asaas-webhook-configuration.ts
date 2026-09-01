import { randomUUID } from 'node:crypto';

import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  removeWebhookBackoff,
  updateWebhook,
  type AsaasWebhookConfig,
} from '@alusa/asaas';
import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import {
  buildExpectedWebhookConfig,
  buildRecommendedWebhookName,
  hasRequiredWebhookEvents,
  normalizeWebhookUrlBase,
  RECOMMENDED_WEBHOOK_NAME,
} from '../use-cases/asaas-account/expected-webhook-config.server';
import { resolveWebhookNotificationEmail } from '../use-cases/asaas-account/webhook-notification-email.server';
import { buildWebhookAuthTokenRotationData } from './asaas-webhook-auth';
import type { WebhookProvisioningCapability } from './webhook-provisioning-events';

const WEBHOOK_LEASE_MS = 90_000;
const ALUSA_WEBHOOK_NAME_PREFIX = RECOMMENDED_WEBHOOK_NAME;

export type EnsureAsaasWebhookStage =
  | 'PREPARE'
  | 'ACQUIRE_LEASE'
  | 'LIST'
  | 'CREATE'
  | 'UPDATE'
  | 'REMOVE_BACKOFF'
  | 'VERIFY'
  | 'PERSIST';

export type EnsureAsaasWebhookAction = 'created' | 'updated' | 'unchanged' | 'recreated';

export class AsaasWebhookConfigurationError extends Error {
  public readonly code:
    | 'ACCOUNT_NOT_FOUND'
    | 'CONFIGURATION_INVALID'
    | 'PROVISIONING_IN_PROGRESS'
    | 'WEBHOOK_LIMIT_REACHED'
    | 'REMOTE_VERIFICATION_FAILED';
  public readonly stage: EnsureAsaasWebhookStage;

  constructor(
    code:
      | 'ACCOUNT_NOT_FOUND'
      | 'CONFIGURATION_INVALID'
      | 'PROVISIONING_IN_PROGRESS'
      | 'WEBHOOK_LIMIT_REACHED'
      | 'REMOTE_VERIFICATION_FAILED',
    stage: EnsureAsaasWebhookStage,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AsaasWebhookConfigurationError';
    this.code = code;
    this.stage = stage;
  }
}

export type EnsureAsaasWebhookConfigurationResult = {
  webhookId: string;
  action: EnsureAsaasWebhookAction;
  authTokenHash: string;
  eventsCount: number;
  duplicateWebhookIdsRemoved: string[];
};

function isAlusaOwnedWebhook(webhook: AsaasWebhookConfig): boolean {
  return typeof webhook.name === 'string' && webhook.name.startsWith(ALUSA_WEBHOOK_NAME_PREFIX);
}

export function selectAlusaWebhookCandidate(params: {
  webhooks: AsaasWebhookConfig[];
  persistedWebhookId?: string | null;
  financeProfileId: string;
  expectedName: string;
}): AsaasWebhookConfig | null {
  const { webhooks } = params;
  if (params.persistedWebhookId) {
    const persisted = webhooks.find((item) => item.id === params.persistedWebhookId);
    if (persisted) return persisted;
  }

  return (
    webhooks.find((item) => item.name === params.expectedName) ??
    webhooks.find((item) => item.name === buildRecommendedWebhookName(params.financeProfileId)) ??
    webhooks.find((item) => item.name === RECOMMENDED_WEBHOOK_NAME) ??
    null
  );
}

export function isWebhookConfigurationOperational(
  webhook: AsaasWebhookConfig,
  expected: ReturnType<typeof buildExpectedWebhookConfig>,
): boolean {
  return (
    webhook.name === expected.name &&
    normalizeWebhookUrlBase(webhook.url) === expected.normalizedUrl &&
    webhook.enabled === true &&
    webhook.interrupted !== true &&
    webhook.apiVersion === expected.apiVersion &&
    webhook.hasAuthToken === true &&
    webhook.sendType === expected.sendType &&
    hasRequiredWebhookEvents(webhook.events, expected.events)
  );
}

async function acquireProvisioningLease(financeProfileId: string): Promise<string> {
  const token = randomUUID();
  const staleBefore = new Date(Date.now() - WEBHOOK_LEASE_MS);
  const acquired = await prisma.asaasAccount.updateMany({
    where: {
      financeProfileId,
      OR: [
        { webhookProvisionLockToken: null },
        { webhookProvisionLockedAt: null },
        { webhookProvisionLockedAt: { lt: staleBefore } },
      ],
    },
    data: {
      webhookProvisionLockToken: token,
      webhookProvisionLockedAt: new Date(),
      provisionLastStage: 'WEBHOOK_ACQUIRE_LEASE',
      provisionLastAttemptAt: new Date(),
    },
  });

  if (acquired.count !== 1) {
    throw new AsaasWebhookConfigurationError(
      'PROVISIONING_IN_PROGRESS',
      'ACQUIRE_LEASE',
      'A configuração do webhook já está em andamento para esta conta.',
    );
  }

  return token;
}

async function releaseProvisioningLease(financeProfileId: string, token: string): Promise<void> {
  await prisma.asaasAccount.updateMany({
    where: { financeProfileId, webhookProvisionLockToken: token },
    data: {
      webhookProvisionLockToken: null,
      webhookProvisionLockedAt: null,
    },
  });
}

async function persistFailure(params: {
  financeProfileId: string;
  leaseToken: string;
  stage: EnsureAsaasWebhookStage;
  error: unknown;
}): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : 'Falha desconhecida';
  await prisma.asaasAccount.updateMany({
    where: {
      financeProfileId: params.financeProfileId,
      webhookProvisionLockToken: params.leaseToken,
    },
    data: {
      webhookStatus: 'DRIFT',
      provisionLastStage: `WEBHOOK_${params.stage}`,
      provisionLastError: message.slice(0, 1000),
      provisionLastAttemptAt: new Date(),
    },
  });
}

async function removeOwnedDuplicatesBestEffort(params: {
  apiKey: string;
  targetWebhookId: string;
  webhooks: AsaasWebhookConfig[];
}): Promise<string[]> {
  const removed: string[] = [];
  for (const webhook of params.webhooks) {
    if (webhook.id === params.targetWebhookId || !isAlusaOwnedWebhook(webhook)) continue;
    try {
      await deleteWebhook({ apiKey: params.apiKey, webhookId: webhook.id });
      removed.push(webhook.id);
    } catch (error) {
      console.warn('[asaas.webhook] Falha não bloqueante ao remover webhook duplicado', {
        webhookId: webhook.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return removed;
}

export async function ensureAsaasWebhookConfiguration(params: {
  contaId: string;
  financeProfileId: string;
  apiKey: string;
  notificationEmail?: string | null;
  actor?: { type: AuditActorType; id?: string };
  persistResult?: boolean;
  persistFailure?: boolean;
  forceAuthTokenRefresh?: boolean;
  capabilities?: readonly WebhookProvisioningCapability[];
}): Promise<EnsureAsaasWebhookConfigurationResult> {
  let stage: EnsureAsaasWebhookStage = 'PREPARE';
  let expected: ReturnType<typeof buildExpectedWebhookConfig>;
  try {
    expected = buildExpectedWebhookConfig(
      params.financeProfileId,
      undefined,
      params.capabilities,
    );
  } catch (error) {
    throw new AsaasWebhookConfigurationError(
      'CONFIGURATION_INVALID',
      stage,
      error instanceof Error ? error.message : 'Configuração pública do webhook inválida.',
      { cause: error },
    );
  }

  const account = await prisma.asaasAccount.findFirst({
    where: {
      financeProfileId: params.financeProfileId,
      financeProfile: { contaId: params.contaId },
    },
    select: {
      id: true,
      webhookId: true,
      webhookAuthTokenHash: true,
    },
  });
  if (!account) {
    throw new AsaasWebhookConfigurationError(
      'ACCOUNT_NOT_FOUND',
      stage,
      'Conta financeira não encontrada no tenant autenticado.',
    );
  }

  const notificationEmail =
    params.notificationEmail?.trim() ||
    (await resolveWebhookNotificationEmail({
      contaId: params.contaId,
      financeProfileId: params.financeProfileId,
    }));
  if (!notificationEmail) {
    throw new AsaasWebhookConfigurationError(
      'CONFIGURATION_INVALID',
      stage,
      'Não foi possível resolver o email de notificação do webhook.',
    );
  }

  stage = 'ACQUIRE_LEASE';
  const leaseToken = await acquireProvisioningLease(params.financeProfileId);

  try {
    stage = 'LIST';
    const response = await listWebhooks({ apiKey: params.apiKey, limit: 100, offset: 0 });
    const webhooks = response.data ?? [];
    const candidate = selectAlusaWebhookCandidate({
      webhooks,
      persistedWebhookId: account.webhookId,
      financeProfileId: params.financeProfileId,
      expectedName: expected.name,
    });

    let action: EnsureAsaasWebhookAction;
    let targetWebhookId: string;

    if (!candidate || candidate.apiVersion !== expected.apiVersion) {
      if (webhooks.length >= 10) {
        throw new AsaasWebhookConfigurationError(
          'WEBHOOK_LIMIT_REACHED',
          'CREATE',
          'A conta Asaas atingiu o limite de 10 webhooks. Remova uma configuração antiga e tente novamente.',
        );
      }

      stage = 'CREATE';
      const created = await createWebhook({
        apiKey: params.apiKey,
        data: {
          name: expected.name,
          url: expected.url,
          email: notificationEmail,
          enabled: true,
          interrupted: false,
          apiVersion: 3,
          authToken: expected.authToken,
          sendType: expected.sendType,
          events: expected.events,
        },
      });
      targetWebhookId = created.id;
      action = candidate ? 'recreated' : 'created';
    } else if (
      isWebhookConfigurationOperational(candidate, expected) &&
      account.webhookAuthTokenHash === expected.authTokenHash &&
      params.forceAuthTokenRefresh !== true
    ) {
      targetWebhookId = candidate.id;
      action = 'unchanged';
    } else {
      if (candidate.interrupted === true && (candidate.penalizedRequestsCount ?? 0) > 0) {
        stage = 'REMOVE_BACKOFF';
        await removeWebhookBackoff({ apiKey: params.apiKey, webhookId: candidate.id });
      }

      stage = 'UPDATE';
      await updateWebhook({
        apiKey: params.apiKey,
        webhookId: candidate.id,
        data: {
          name: expected.name,
          url: expected.url,
          enabled: true,
          interrupted: false,
          authToken: expected.authToken,
          sendType: expected.sendType,
          events: expected.events,
        },
      });
      targetWebhookId = candidate.id;
      action = 'updated';
    }

    stage = 'VERIFY';
    const verified = await getWebhook({ apiKey: params.apiKey, webhookId: targetWebhookId });
    if (!isWebhookConfigurationOperational(verified, expected)) {
      throw new AsaasWebhookConfigurationError(
        'REMOTE_VERIFICATION_FAILED',
        stage,
        'O Asaas não confirmou a configuração esperada do webhook.',
      );
    }

    const duplicateWebhookIdsRemoved = await removeOwnedDuplicatesBestEffort({
      apiKey: params.apiKey,
      targetWebhookId,
      webhooks,
    });

    if (params.persistResult !== false) {
      stage = 'PERSIST';
      await prisma.asaasAccount.update({
        where: { financeProfileId: params.financeProfileId },
        data: {
          webhookId: targetWebhookId,
          webhookStatus: 'ACTIVE',
          lastWebhookCheckAt: new Date(),
          provisionLastStage: 'WEBHOOK_VERIFIED',
          provisionLastError: null,
          ...buildWebhookAuthTokenRotationData({
            currentHash: account.webhookAuthTokenHash,
            nextHash: expected.authTokenHash,
          }),
        },
        select: { id: true },
      });
    }

    await auditLogService.record({
      contaId: params.contaId,
      action: `finance.webhook.config_${action}`,
      entity: { type: 'AsaasAccount', id: account.id },
      metadata: {
        webhookId: targetWebhookId,
        eventsCount: expected.events.length,
        sendType: expected.sendType,
        apiVersion: expected.apiVersion,
        duplicateWebhookIdsRemoved,
      },
      actor: params.actor,
    });

    return {
      webhookId: targetWebhookId,
      action,
      authTokenHash: expected.authTokenHash,
      eventsCount: expected.events.length,
      duplicateWebhookIdsRemoved,
    };
  } catch (error) {
    if (params.persistFailure !== false) {
      await persistFailure({
        financeProfileId: params.financeProfileId,
        leaseToken,
        stage,
        error,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await releaseProvisioningLease(params.financeProfileId, leaseToken).catch(() => undefined);
  }
}
