import { createStructuredLog, sharedTelemetry } from '@alusa/observability';

export type LibOperationalEventName =
  | 'student.asaas.sync.failed'
  | 'student.archive.enrollments.failed'
  | 'student.archive.asaas_deactivation.failed'
  | 'modality.create.failed'
  | 'room.create.failed'
  | 'notification.billing.create.failed'
  | 'notification.pending_inbox.enqueue.failed'
  | 'notification.matricula.create.failed'
  | 'notification.enrollment.renewed.failed'
  | 'notification.enrollment.lifecycle.failed'
  | 'notification.contract.signed.failed'
  | 'notification.contract.cancelled.failed'
  | 'notification.contract.expired.failed'
  | 'notification.contract.expiring.failed'
  | 'notification.experimental.failed'
  | 'notification.finance.unsupported_event'
  | 'event_map.reservation.expire.skipped'
  | 'rate_limit.redis.fallback'
  | 'rate_limit.strict.unavailable'
  | 'rate_limit.auth.unavailable'
  | 'inbox.created'
  | 'inbox.deduped'
  | 'inbox.skipped.policy'
  | 'inbox.skipped.no_recipients'
  | 'inbox.skipped.no_entity'
  | 'inbox.skipped.unsupported_event'
  | 'inbox.pending.enqueued'
  | 'inbox.pending.lease_lost'
  | 'inbox.pending.processed'
  | 'inbox.pending.failed'
  | 'inbox.overdue.emitted'
  | 'inbox.overdue.skipped'
  | 'inbox.retention.archived';

const EMIT_INTERVAL_MS = 60_000;
const buckets = new Map<LibOperationalEventName, { count: number; lastEmittedAt: number }>();
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'PrismaClientKnownRequestError',
  'PrismaClientValidationError',
  'AsaasHttpError',
  'AsaasCustomerEnsureError',
]);

function safeErrorType(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return SAFE_ERROR_NAMES.has(error.name) ? error.name : 'Error';
}

/**
 * Shared best-effort logger for reusable lib services. It retains no request,
 * tenant, entity, or error data; repeated event names are summarized per minute.
 */
export function logLibOperationalEvent(params: {
  eventName: LibOperationalEventName;
  error?: unknown;
  severity?: 'info' | 'warn' | 'error';
  count?: number;
}): void {
  const now = Date.now();
  const bucket = buckets.get(params.eventName) ?? { count: 0, lastEmittedAt: 0 };
  const increment = Number.isSafeInteger(params.count) && (params.count ?? -1) >= 0
    ? params.count ?? 1
    : 1;
  bucket.count += increment;
  buckets.set(params.eventName, bucket);
  if (bucket.lastEmittedAt > 0 && now - bucket.lastEmittedAt < EMIT_INTERVAL_MS) return;

  const log = createStructuredLog({
    severity: params.severity ?? 'warn',
    'service.name': 'alusa-lib',
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    'error.type': safeErrorType(params.error),
    attributes: { count: bucket.count },
    allowedAttributes: ['count'],
  });
  bucket.count = 0;
  bucket.lastEmittedAt = now;
  if (log.severity === 'error') console.error(JSON.stringify(log));
  else if (log.severity === 'warn') console.warn(JSON.stringify(log));
  else console.info(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
