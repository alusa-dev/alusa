import { createWebhook, listWebhooks, removeWebhookBackoff, updateWebhook } from '@alusa/asaas';
import type { AsaasWebhookConfig } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { auditLogService } from '../foundation/audit-log.service';
import {
  buildExpectedWebhookConfig,
  hasSameWebhookEvents,
  normalizeWebhookUrlBase,
} from '../use-cases/asaas-account/expected-webhook-config.server';
import { resolveWebhookNotificationEmail } from '../use-cases/asaas-account/webhook-notification-email.server';

const MAX_WEBHOOK_PAGES = 10;
const PAGE_SIZE = 100;

async function listAllWebhooks(apiKey: string): Promise<AsaasWebhookConfig[]> {
  const all: AsaasWebhookConfig[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_WEBHOOK_PAGES; page++) {
    const response = await listWebhooks({ apiKey, limit: PAGE_SIZE, offset });
    all.push(...response.data);
    if (!response.hasMore || response.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export interface WebhookConfigDriftStatus {
  contaId: string;
  asaasAccountId: string;
  financeProfileId: string;
  expected: {
    url: string;
    sendType: string;
    events: string[];
    authTokenHash: string;
  };
  remote: {
    webhookId: string | null;
    url: string | null;
    enabled: boolean;
    interrupted: boolean;
    hasAuthToken: boolean;
    sendType: string | null;
    penalizedRequestsCount: number;
    events: string[];
  };
  drift: {
    remoteMissing: boolean;
    urlMismatch: boolean;
    disabled: boolean;
    interrupted: boolean;
    missingAuthToken: boolean;
    sendTypeMismatch: boolean;
    eventsMismatch: boolean;
    localHashMismatch: boolean;
    penalized: boolean;
    missingEvents: string[];
    extraEvents: string[];
  };
  canRepair: boolean;
}

export interface RepairWebhookConfigDriftResult {
  repaired: boolean;
  reason: 'REPAIRED' | 'NO_DRIFT' | 'REMOTE_NOT_FOUND' | 'ASAAS_ACCOUNT_NOT_READY' | 'CREDENTIALS_MISSING';
  before: WebhookConfigDriftStatus | null;
  after: WebhookConfigDriftStatus | null;
  failureCategory?: string;
  failureStatus?: number | null;
}

function selectCandidateWebhook(webhooks: AsaasWebhookConfig[], expected: ReturnType<typeof buildExpectedWebhookConfig>) {
  return (
    webhooks.find((item) => normalizeWebhookUrlBase(item.url) === expected.normalizedUrl) ??
    webhooks.find((item) => item.name === expected.name) ??
    null
  );
}

function computeDrift(params: {
  account: { contaId: string; asaasAccountId: string; financeProfileId: string; webhookAuthTokenHash: string | null };
  expected: ReturnType<typeof buildExpectedWebhookConfig>;
  webhook: AsaasWebhookConfig | null;
}): WebhookConfigDriftStatus {
  const { account, expected, webhook } = params;
  const remoteEvents = webhook?.events ?? [];
  const missingEvents = expected.events.filter((event) => !remoteEvents.includes(event));
  const extraEvents = remoteEvents.filter((event) => !expected.events.includes(event));

  const drift = {
    remoteMissing: webhook === null,
    urlMismatch: webhook ? normalizeWebhookUrlBase(webhook.url) !== expected.normalizedUrl : false,
    disabled: webhook ? webhook.enabled === false : false,
    interrupted: webhook ? webhook.interrupted === true : false,
    missingAuthToken: webhook ? webhook.hasAuthToken === false : false,
    sendTypeMismatch: webhook ? webhook.sendType !== expected.sendType : false,
    eventsMismatch: webhook ? !hasSameWebhookEvents(webhook.events, expected.events) : false,
    localHashMismatch: account.webhookAuthTokenHash !== expected.authTokenHash,
    penalized: webhook ? (webhook.penalizedRequestsCount ?? 0) > 0 : false,
    missingEvents,
    extraEvents,
  };

  return {
    contaId: account.contaId,
    asaasAccountId: account.asaasAccountId,
    financeProfileId: account.financeProfileId,
    expected: {
      url: expected.url,
      sendType: expected.sendType,
      events: [...expected.events],
      authTokenHash: expected.authTokenHash,
    },
    remote: {
      webhookId: webhook?.id ?? null,
      url: webhook?.url ?? null,
      enabled: webhook?.enabled ?? false,
      interrupted: webhook?.interrupted ?? false,
      hasAuthToken: webhook?.hasAuthToken ?? false,
      sendType: webhook?.sendType ?? null,
      penalizedRequestsCount: webhook?.penalizedRequestsCount ?? 0,
      events: [...remoteEvents],
    },
    drift,
    canRepair: webhook !== null,
  };
}

export async function getWebhookConfigDriftStatus(contaId: string): Promise<WebhookConfigDriftStatus | null> {
  const account = await prisma.asaasAccount.findFirst({
    where: {
      asaasAccountId: { not: null },
      financeProfile: { contaId },
    },
    select: {
      id: true,
      asaasAccountId: true,
      financeProfileId: true,
      webhookAuthTokenHash: true,
      financeProfile: { select: { contaId: true } },
    },
  });

  if (!account?.asaasAccountId) return null;

  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials?.apiKey) return null;

  const expected = buildExpectedWebhookConfig(account.financeProfileId);
  const allWebhooks = await listAllWebhooks(credentials.apiKey);
  const webhook = selectCandidateWebhook(allWebhooks, expected);

  return computeDrift({
    account: {
      contaId: account.financeProfile.contaId,
      asaasAccountId: account.asaasAccountId,
      financeProfileId: account.financeProfileId,
      webhookAuthTokenHash: account.webhookAuthTokenHash,
    },
    expected,
    webhook,
  });
}

export async function repairWebhookConfigDrift(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<RepairWebhookConfigDriftResult> {
  try {
    const before = await getWebhookConfigDriftStatus(params.contaId);
    if (!before) {
      const account = await prisma.asaasAccount.findFirst({
        where: { financeProfile: { contaId: params.contaId } },
        select: { asaasAccountId: true },
      });

      if (!account?.asaasAccountId) {
        return { repaired: false, reason: 'ASAAS_ACCOUNT_NOT_READY', before: null, after: null };
      }

      return { repaired: false, reason: 'CREDENTIALS_MISSING', before: null, after: null };
    }

    const hasDrift = Object.entries(before.drift)
      .filter(([key]) => key !== 'missingEvents' && key !== 'extraEvents')
      .some(([, value]) => value === true);

    if (!hasDrift && before.drift.missingEvents.length === 0 && before.drift.extraEvents.length === 0) {
      return { repaired: false, reason: 'NO_DRIFT', before, after: before };
    }

    if (!before.canRepair || !before.remote.webhookId) {
      const credentials = await loadAsaasCredentials(params.contaId);
      if (!credentials?.apiKey) {
        return { repaired: false, reason: 'CREDENTIALS_MISSING', before, after: before };
      }

    const expected = buildExpectedWebhookConfig(before.financeProfileId);
    const webhookNotificationEmail = await resolveWebhookNotificationEmail({
      contaId: params.contaId,
      financeProfileId: before.financeProfileId,
    });

    if (!webhookNotificationEmail) {
      throw new Error('Não foi possível resolver o email do webhook do Asaas.');
    }

      const created = await createWebhook({
        apiKey: credentials.apiKey,
        data: {
          name: expected.name,
          url: expected.url,
          email: webhookNotificationEmail,
          enabled: true,
          interrupted: false,
          apiVersion: 3,
          authToken: expected.authToken,
          sendType: expected.sendType,
          events: expected.events,
        },
      });

      if (before.drift.localHashMismatch) {
        await prisma.asaasAccount.update({
          where: { financeProfileId: before.financeProfileId },
          data: { webhookAuthTokenHash: expected.authTokenHash },
          select: { id: true },
        });
      }

      const after = await getWebhookConfigDriftStatus(params.contaId);

      await auditLogService.record({
        contaId: params.contaId,
        action: 'finance.webhook.config_created',
        entity: { type: 'AsaasAccount', id: before.asaasAccountId },
        metadata: {
          webhookId: created.id,
          url: expected.url,
          eventsCount: expected.events.length,
        },
        actor: params.actor,
      });

      return { repaired: true, reason: 'REPAIRED', before, after };
    }

    const credentials = await loadAsaasCredentials(params.contaId);
    if (!credentials?.apiKey) {
      return { repaired: false, reason: 'CREDENTIALS_MISSING', before, after: before };
    }

    const expected = buildExpectedWebhookConfig(before.financeProfileId);
    const webhookNotificationEmail = await resolveWebhookNotificationEmail({
      contaId: params.contaId,
      financeProfileId: before.financeProfileId,
    });

    if (!webhookNotificationEmail) {
      throw new Error('Não foi possível resolver o email do webhook do Asaas.');
    }

    if (before.drift.penalized) {
      await removeWebhookBackoff({
        apiKey: credentials.apiKey,
        webhookId: before.remote.webhookId,
      });
    }

    await updateWebhook({
      apiKey: credentials.apiKey,
      webhookId: before.remote.webhookId,
      data: {
        name: expected.name,
        url: expected.url,
        email: webhookNotificationEmail,
        enabled: true,
        interrupted: false,
        authToken: expected.authToken,
        sendType: expected.sendType,
        events: expected.events,
      },
    });

    if (before.drift.localHashMismatch) {
      await prisma.asaasAccount.update({
        where: { financeProfileId: before.financeProfileId },
        data: { webhookAuthTokenHash: expected.authTokenHash },
        select: { id: true },
      });
    }

    const after = await getWebhookConfigDriftStatus(params.contaId);

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.webhook.config_repaired',
      entity: { type: 'AsaasAccount', id: before.asaasAccountId },
      metadata: {
        webhookId: before.remote.webhookId,
        missingEvents: before.drift.missingEvents,
        extraEvents: before.drift.extraEvents,
        repairedDisabled: before.drift.disabled,
        repairedInterrupted: before.drift.interrupted,
        repairedMissingAuthToken: before.drift.missingAuthToken,
        repairedSendTypeMismatch: before.drift.sendTypeMismatch,
        repairedUrlMismatch: before.drift.urlMismatch,
        repairedLocalHashMismatch: before.drift.localHashMismatch,
      },
      actor: params.actor,
    });

    return { repaired: true, reason: 'REPAIRED', before, after };
  } catch (error) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');
    return {
      repaired: false,
      reason: 'CREDENTIALS_MISSING',
      before: null,
      after: null,
      failureCategory: failure.category,
      failureStatus: failure.status,
    };
  }
}
