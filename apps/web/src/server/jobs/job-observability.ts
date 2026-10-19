import { randomUUID } from 'node:crypto';
import {
  createStructuredLog,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';

type JobResultLike = Record<string, unknown>;

export type JobWorkStatus = 'empty' | 'worked' | 'unknown';
export type JobResultExtra = Record<string, unknown> & {
  workStatus?: JobWorkStatus;
};

export interface JobRunContext {
  readonly startedAt: number;
  readonly correlationId: string;
}

type TenantScopeResolution = {
  ok: boolean;
  response?: { status?: number };
};

function requestRejectionStatus(status: number | undefined) {
  const knownStatuses: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'unprocessable',
    429: 'rate_limited',
  };
  if (status !== undefined && knownStatuses[status]) return knownStatuses[status];
  if (typeof status === 'number' && status >= 500 && status < 600) return 'server_error';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'client_error';
  return 'other';
}

export function recordJobRequestRejected(jobName: string, status: number | undefined) {
  const name = safeJobName(jobName);
  const result = requestRejectionStatus(status);
  const dimensions = normalizeMetricDimensions(
    { 'job.name': name, result },
    ['job.name', 'result'],
  );
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.job.request_rejected',
    value: 1,
    dimensions,
  });
  const log = createStructuredLog({
    severity: 'warn',
    'service.name': 'alusa-web',
    'event.name': 'job.request_rejected',
    attributes: { jobName: name, status: result },
    allowedAttributes: ['jobName', 'status'],
  });
  console.warn(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}

/** Resolve a job's tenant authorization before recording a job execution. */
export async function resolveTenantScopeForJob<T extends TenantScopeResolution>(
  jobName: string,
  resolve: () => Promise<T>,
): Promise<T> {
  try {
    const scope = await resolve();
    if (!scope.ok) recordJobRequestRejected(jobName, scope.response?.status);
    return scope;
  } catch (error) {
    recordJobRequestRejected(jobName, 500);
    throw error;
  }
}

const SAFE_EXTRA_FIELDS = new Set([
  'dryRun',
  'hasTenantScope',
  'targetedPayment',
  'targetedAccount',
  'partial',
  'partialFailure',
  'attentionRequired',
  'skippedDueToLock',
  'failedSteps',
  'failedStages',
  'budgetExhausted',
  'maxAsaasCallsPerAccount',
  'accountsNearAsaasCallBudget',
  'accountsAtAsaasCallBudget',
  'maxAsaasCallBudgetUtilizationPercent',
]);
const COUNT_FIELDS = new Set([
  'processed',
  'expired',
  'consistent',
  'issued',
  'inspected',
  'findingCount',
  'scanned',
  'addressSynced',
  'updated',
  'deleted',
  'missingCredentials',
  'failed',
  'skipped',
  'retried',
  'queued',
  'sent',
  'errors',
  'count',
  'sideEffectsProcessed',
  'sideEffectsFailed',
  'enrollmentAttempted',
  'enrollmentProcessed',
  'familyAttempted',
  'familyProcessed',
  'individualAttempted',
  'individualProcessed',
  'webhooksReprocessed',
  'processedPayments',
  'recovered',
  'marked',
  'errorCount',
  'attempted',
  'created',
  'selected',
  'archived',
  'deletedFromHot',
  'succeeded',
  'recoveryRequired',
  'exhausted',
  'webhookJobsQueued',
  'reconciled',
  'fetched',
  'accounts',
  'accountsProcessed',
  'checked',
  'restricted',
  'notified',
  'submitted',
  'issues',
  'synced',
  'paidChargesScanned',
  'paidChargesRecovered',
  'paidChargesFailed',
  'subscriptionSettingsScanned',
  'subscriptionSettingsSynced',
  'subscriptionSettingsFailed',
  'subscriptionsProjected',
  'installmentsProjected',
  'remoteSubscriptionsRefreshed',
  'remoteInstallmentsRefreshed',
  'transactionsScanned',
  'dailyAggregates',
  'monthlyAggregates',
  'inconsistenciesFound',
  'checkedAccounts',
  'accountsChecked',
  'driftsFound',
  'driftsRepaired',
  'updatedEnrollments',
  'updatedContracts',
  'processedAccounts',
  'tenants',
  'emitted',
  'evaluated',
  'cobrancasAtualizadas',
  'processadas',
  'reconciliadas',
  'skippedThrottle',
  'checkedPayments',
  'reconciledPayments',
  'checkedSubscriptions',
  'reconciledSubscriptions',
  'checkedInstallments',
  'installmentDrift',
  'paymentDrift',
  'subscriptionDrift',
  'storeSalesFulfilled',
  'asaasCalls',
  'webhooksProcessed',
  'webhooksFailed',
  'webhooksExhausted',
  'webhookNotificationsClaimed',
  'webhookNotificationsDelivered',
  'webhookNotificationsFailed',
  'webhookNotificationsExhausted',
  'planChangesChecked',
  'planChangesSubmitted',
  'planChangesFailed',
  'trialsChecked',
  'trialsRestricted',
  'trialsNotified',
  'gracePeriodsChecked',
  'gracePeriodsRestricted',
  'gracePeriodsNotified',
  'billingAccountsChecked',
  'billingIssues',
  'failedAccounts',
  'contractsMaterialized',
  'contractsFailed',
  'agreementsQueued',
  'agreementsSkipped',
  'outboxProcessed',
  'outboxFailed',
  'outboxSkipped',
  'activationsCompleted',
  'activationsNeedingAttention',
  'expired',
  'updated',
  'deleted',
  'failedSteps',
  'failedStages',
  'commandsScanned',
  'staleCommandsScanned',
  'staleCommandsMarked',
  'outboundOperationsScanned',
  'enrollmentCreationsInspected',
  'contractNotificationsClaimed',
  'contractNotificationsRetried',
  'contractNotificationsDeadLettered',
  'eventTicketNotificationsClaimed',
  'eventTicketNotificationsRetried',
  'eventTicketNotificationsDeadLettered',
  'whatsappOutboxClaimed',
  'whatsappOutboxSent',
  'whatsappOutboxRetried',
  'whatsappOutboxDeadLettered',
  'whatsappWebhooksClaimed',
  'whatsappWebhooksProcessed',
  'whatsappWebhooksRetried',
  'whatsappWebhooksDeadLettered',
  'eligibleClosures',
  'storageObjectsDeleted',
  'reservationsUpdated',
]);

function safeJobName(jobName: string) {
  return /^[a-z][a-z0-9._-]{0,63}$/i.test(jobName) && !/[-_]\d{2,}/.test(jobName)
    ? jobName.toLowerCase()
    : 'unknown';
}

const STEP_COUNT_FIELDS = new Set([
  'scanned', 'attempted', 'processed', 'failed', 'skipped', 'recovered', 'driftsFound',
  'driftsRepaired', 'archived', 'selected', 'marked', 'interruptedFound',
  'recoveredSuccessfully', 'recoveryFailed', 'errors', 'eligible', 'enqueued',
  'checkedPayments', 'reconciledPayments', 'checkedSubscriptions',
  'reconciledSubscriptions', 'checkedInstallments', 'storeSalesFulfilled',
  'accountsChecked', 'accountFailures', 'checkedAccounts', 'asaasCalls',
  'deletedFromHot',
]);

function numericFields(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};

  return Object.fromEntries(
    Object.entries(result as JobResultLike).filter(
      ([key, value]) =>
        COUNT_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value),
    ),
  );
}

function safeExtraFields(extra: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(extra).filter(([key, value]) => {
      if (key === 'workStatus') {
        return value === 'empty' || value === 'worked' || value === 'unknown';
      }
      return SAFE_EXTRA_FIELDS.has(key) &&
        (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
    }),
  );
}

function numericExtraFields(extra: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(extra).filter(
      ([key, value]) =>
        COUNT_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value),
    ),
  );
}

function safeStepResults(result: unknown) {
  if (!result || typeof result !== 'object' || !Array.isArray((result as JobResultLike).steps)) {
    return [];
  }

  return ((result as JobResultLike).steps as unknown[]).flatMap((step) => {
    if (!step || typeof step !== 'object') return [];
    const value = step as Record<string, unknown>;
    if (
      typeof value.step !== 'string' ||
      !/^[a-z][a-z0-9_]{0,47}$/.test(value.step) ||
      typeof value.ok !== 'boolean' ||
      typeof value.durationMs !== 'number' ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0
    ) return [];
    const detail = value.detail && typeof value.detail === 'object' && !Array.isArray(value.detail)
      ? value.detail as Record<string, unknown>
      : {};
    const counts = Object.fromEntries(Object.entries(detail).filter(([key, count]) =>
      STEP_COUNT_FIELDS.has(key) && typeof count === 'number' && Number.isFinite(count) && count >= 0));
    return [{ step: value.step, ok: value.ok, durationMs: value.durationMs, counts }];
  });
}

export function logJobResult(
  jobName: string,
  startedAt: number | JobRunContext,
  result: unknown,
  extra: JobResultExtra = {},
) {
  const startedAtMs = typeof startedAt === 'number' ? startedAt : startedAt.startedAt;
  const correlationId = typeof startedAt === 'number' ? undefined : startedAt.correlationId;
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  const name = safeJobName(jobName);
  const safeExtras = safeExtraFields(extra);
  const outcome = safeExtras.partialFailure === true
    ? 'partial_failure'
    : safeExtras.attentionRequired === true
      ? 'needs_attention'
      : 'success';
  const counts = { ...numericFields(result), ...numericExtraFields(extra) };
  const steps = safeStepResults(result);
  const workStatus = safeExtras.workStatus ?? 'unknown';
  const dimensions = normalizeMetricDimensions({ 'job.name': name, result: outcome });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.job.completed',
    value: 1,
    dimensions,
  });
  void sharedTelemetry.recordMetric({
    kind: 'distribution',
    name: 'alusa.job.duration',
    value: durationMs,
    unit: 'millisecond',
    dimensions,
  });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.job.run.classification',
    value: 1,
    dimensions: normalizeMetricDimensions(
      { 'job.name': name, result: workStatus },
      ['job.name', 'result'],
    ),
  });
  for (const [field, value] of Object.entries(counts)) {
    if (typeof value === 'number' && value >= 0) {
      void sharedTelemetry.recordMetric({
        kind: 'counter',
        name: 'alusa.job.items',
        value,
        dimensions: normalizeMetricDimensions({ 'job.name': name, result: field }),
      });
    }
  }
  if (name === 'reconcile-finance-webhooks' && typeof safeExtras.maxAsaasCallBudgetUtilizationPercent === 'number') {
    const budgetDimensions = normalizeMetricDimensions(
      { 'job.name': name, result: safeExtras.attentionRequired === true ? 'near_budget' : 'within_budget' },
      ['job.name', 'result'],
    );
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.job.asaas_call_budget_utilization',
      value: safeExtras.maxAsaasCallBudgetUtilizationPercent,
      unit: 'percent',
      dimensions: budgetDimensions,
    });
  }
  for (const step of steps) {
    const stepResult = step.ok ? 'success' : 'error';
    const stepDimensions = normalizeMetricDimensions(
      { 'job.name': name, 'job.step': step.step, result: stepResult },
      ['job.name', 'job.step', 'result'],
    );
    void sharedTelemetry.recordMetric({
      kind: 'counter',
      name: 'alusa.job.step.completed',
      value: 1,
      dimensions: stepDimensions,
    });
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.job.step.duration',
      value: step.durationMs,
      unit: 'millisecond',
      dimensions: stepDimensions,
    });
    for (const [field, count] of Object.entries(step.counts)) {
      void sharedTelemetry.recordMetric({
        kind: 'counter',
        name: 'alusa.job.step.items',
        value: count as number,
        dimensions: normalizeMetricDimensions(
          { 'job.name': name, 'job.step': step.step, result: field },
          ['job.name', 'job.step', 'result'],
        ),
      });
    }
  }
  const log = createStructuredLog({
    severity: outcome === 'success' ? 'info' : 'warn',
    'service.name': 'alusa-web',
    'event.name': outcome === 'partial_failure'
      ? 'job.partial_failure'
      : outcome === 'needs_attention'
        ? 'job.needs_attention'
        : 'job.completed',
    duration_ms: durationMs,
    attributes: { jobName: name, ...(correlationId ? { correlationId } : {}), ...counts, ...safeExtras, steps },
    allowedAttributes: ['jobName', ...(correlationId ? ['correlationId'] : []), ...Object.keys(counts), ...Object.keys(safeExtras), 'steps'],
  });
  if (outcome !== 'success') console.warn(JSON.stringify(log));
  else console.info(JSON.stringify(log));
}

export function logJobFailure(
  jobName: string,
  startedAt: number | JobRunContext,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const startedAtMs = typeof startedAt === 'number' ? startedAt : startedAt.startedAt;
  const correlationId = typeof startedAt === 'number' ? undefined : startedAt.correlationId;
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  const name = safeJobName(jobName);
  const safeExtras = safeExtraFields(extra);
  const errorType =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
      ? error.name
      : error instanceof Error
        ? 'Error'
        : 'unknown_error';
  const dimensions = normalizeMetricDimensions({ 'job.name': name, result: 'error' });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.job.failed',
    value: 1,
    dimensions,
  });
  void sharedTelemetry.recordMetric({
    kind: 'distribution',
    name: 'alusa.job.duration',
    value: durationMs,
    unit: 'millisecond',
    dimensions,
  });
  const log = createStructuredLog({
    severity: 'error',
    'service.name': 'alusa-web',
    'event.name': 'job.failed',
    duration_ms: durationMs,
    'error.type': errorType,
    attributes: { jobName: name, ...(correlationId ? { correlationId } : {}), ...safeExtras },
    allowedAttributes: ['jobName', ...(correlationId ? ['correlationId'] : []), ...Object.keys(safeExtras)],
  });
  console.error(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}

export function startJobRun(jobName: string, startedAt = Date.now()): JobRunContext {
  const name = safeJobName(jobName);
  const correlationId = randomUUID();
  const log = createStructuredLog({
    severity: 'info',
    'service.name': 'alusa-web',
    'event.name': 'job.started',
    timestamp: new Date(startedAt).toISOString(),
    attributes: { jobName: name, correlationId },
    allowedAttributes: ['jobName', 'correlationId'],
  });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.job.started',
    value: 1,
    dimensions: normalizeMetricDimensions({ 'job.name': name }, ['job.name']),
  });
  console.info(JSON.stringify(log));
  return Object.freeze({ startedAt, correlationId });
}
