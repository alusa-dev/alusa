import {
  createStructuredLog,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';

type JobResultLike = Record<string, unknown>;

const SAFE_EXTRA_FIELDS = new Set([
  'dryRun',
  'hasTenantScope',
  'targetedPayment',
  'targetedAccount',
  'partial',
  'partialFailure',
  'skippedDueToLock',
  'failedSteps',
  'failedStages',
]);
const COUNT_FIELDS = new Set([
  'processed',
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
  'updated',
  'deleted',
  'failedSteps',
  'failedStages',
]);

function safeJobName(jobName: string) {
  return /^[a-z][a-z0-9._-]{0,63}$/i.test(jobName) && !/[-_]\d{2,}/.test(jobName)
    ? jobName.toLowerCase()
    : 'unknown';
}

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
    Object.entries(extra).filter(
      ([key, value]) =>
        SAFE_EXTRA_FIELDS.has(key) &&
        (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))),
    ),
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

export function logJobResult(
  jobName: string,
  startedAt: number,
  result: unknown,
  extra: Record<string, unknown> = {},
) {
  const durationMs = Math.max(0, Date.now() - startedAt);
  const name = safeJobName(jobName);
  const safeExtras = safeExtraFields(extra);
  const outcome = safeExtras.partialFailure === true ? 'partial_failure' : 'success';
  const counts = { ...numericFields(result), ...numericExtraFields(extra) };
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
  const log = createStructuredLog({
    severity: outcome === 'partial_failure' ? 'warn' : 'info',
    'service.name': 'alusa-web',
    'event.name': outcome === 'partial_failure' ? 'job.partial_failure' : 'job.completed',
    duration_ms: durationMs,
    attributes: { jobName: name, ...counts, ...safeExtras },
    allowedAttributes: ['jobName', ...Object.keys(counts), ...Object.keys(safeExtras)],
  });
  console.info(JSON.stringify(log));
}

export function logJobFailure(
  jobName: string,
  startedAt: number,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const durationMs = Math.max(0, Date.now() - startedAt);
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
    attributes: { jobName: name, ...safeExtras },
    allowedAttributes: ['jobName', ...Object.keys(safeExtras)],
  });
  console.error(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
