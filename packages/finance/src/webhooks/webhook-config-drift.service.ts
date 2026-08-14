import { listWebhooks } from '@alusa/asaas';
import type { AsaasWebhookConfig } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import {
  buildExpectedWebhookConfig,
  hasSameWebhookEvents,
  normalizeWebhookUrlBase,
} from '../use-cases/asaas-account/expected-webhook-config.server';
import {
  ensureAsaasWebhookConfiguration,
  selectAlusaWebhookCandidate,
} from './ensure-asaas-webhook-configuration';
import {
  buildFinanceReconciliationIssueDedupeKey,
  resolveFinanceReconciliationIssueByDedupe,
  upsertFinanceReconciliationIssue,
} from '../reconciliation/finance-reconciliation-issue.service';

const MAX_WEBHOOK_PAGES = 10;
const PAGE_SIZE = 100;

function hasWebhookConfigDrift(status: WebhookConfigDriftStatus): boolean {
  return (
    status.drift.remoteMissing ||
    status.drift.urlMismatch ||
    status.drift.disabled ||
    status.drift.interrupted ||
    status.drift.missingAuthToken ||
    status.drift.sendTypeMismatch ||
    status.drift.eventsMismatch ||
    status.drift.localHashMismatch ||
    status.drift.penalized
  );
}

async function recordWebhookConfigDriftIssue(status: WebhookConfigDriftStatus): Promise<void> {
  await upsertFinanceReconciliationIssue({
    contaId: status.contaId,
    entityType: 'ASAAS_ACCOUNT',
    entityId: status.asaasAccountId,
    asaasId: status.asaasAccountId,
    issueType: 'WEBHOOK_CONFIG_DRIFT',
    severity: status.drift.interrupted || status.drift.remoteMissing || status.drift.disabled ? 'CRITICAL' : 'HIGH',
    localStatus: null,
    remoteStatus: status.remote.interrupted ? 'INTERRUPTED' : status.remote.enabled ? 'ENABLED' : 'DISABLED',
    metadata: {
      drift: status.drift,
      remote: status.remote,
      expected: {
        url: status.expected.url,
        sendType: status.expected.sendType,
        eventsCount: status.expected.events.length,
      },
      source: 'webhook-config-drift.service',
    },
  });
}

async function resolveWebhookConfigDriftIssue(status: WebhookConfigDriftStatus): Promise<void> {
  const dedupeKey = buildFinanceReconciliationIssueDedupeKey({
    entityType: 'ASAAS_ACCOUNT',
    entityId: status.asaasAccountId,
    asaasId: status.asaasAccountId,
    issueType: 'WEBHOOK_CONFIG_DRIFT',
  });

  await resolveFinanceReconciliationIssueByDedupe({
    contaId: status.contaId,
    dedupeKey,
    resolution: 'Webhook remoto verificado sem drift.',
  });
}

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

function computeDrift(params: {
  account: {
    contaId: string;
    asaasAccountId: string;
    financeProfileId: string;
    webhookId: string | null;
    webhookAuthTokenHash: string | null;
  };
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
    // O contador pode permanecer histórico após reativar a fila. Só é acionável
    // quando a fila também está interrompida.
    penalized: webhook ? webhook.interrupted === true && (webhook.penalizedRequestsCount ?? 0) > 0 : false,
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
      webhookId: true,
      webhookAuthTokenHash: true,
      financeProfile: { select: { contaId: true } },
    },
  });

  if (!account?.asaasAccountId) return null;

  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials?.apiKey) return null;

  const expected = buildExpectedWebhookConfig(account.financeProfileId);
  const allWebhooks = await listAllWebhooks(credentials.apiKey);
  const webhook = selectAlusaWebhookCandidate({
    webhooks: allWebhooks,
    persistedWebhookId: account.webhookId,
    financeProfileId: account.financeProfileId,
    expectedName: expected.name,
  });

  return computeDrift({
    account: {
      contaId: account.financeProfile.contaId,
      asaasAccountId: account.asaasAccountId,
      financeProfileId: account.financeProfileId,
      webhookId: account.webhookId,
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

    const hasDrift = hasWebhookConfigDrift(before);

    if (!hasDrift && before.drift.missingEvents.length === 0 && before.drift.extraEvents.length === 0) {
      await resolveWebhookConfigDriftIssue(before);
      return { repaired: false, reason: 'NO_DRIFT', before, after: before };
    }

    await recordWebhookConfigDriftIssue(before);
    const credentials = await loadAsaasCredentials(params.contaId);
    if (!credentials?.apiKey) {
      return { repaired: false, reason: 'CREDENTIALS_MISSING', before, after: before };
    }

    await ensureAsaasWebhookConfiguration({
      contaId: params.contaId,
      financeProfileId: before.financeProfileId,
      apiKey: credentials.apiKey,
      actor: params.actor,
    });

    const after = await getWebhookConfigDriftStatus(params.contaId);

    if (after && !hasWebhookConfigDrift(after) && after.drift.missingEvents.length === 0 && after.drift.extraEvents.length === 0) {
      await resolveWebhookConfigDriftIssue(after);
    }

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
