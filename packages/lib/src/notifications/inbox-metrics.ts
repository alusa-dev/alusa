export type InboxMetricEvent =
  | 'inbox.created'
  | 'inbox.deduped'
  | 'inbox.skipped.policy'
  | 'inbox.skipped.no_recipients'
  | 'inbox.skipped.no_entity'
  | 'inbox.skipped.unsupported_event'
  | 'inbox.pending.enqueued'
  | 'inbox.pending.processed'
  | 'inbox.pending.failed'
  | 'inbox.overdue.emitted'
  | 'inbox.overdue.skipped'
  | 'inbox.retention.archived';

type MetricBucket = {
  count: number;
  firstContext: Record<string, unknown>;
  lastEmittedAt: number;
};

const EMIT_INTERVAL_MS = 60_000;
const CRITICAL_EVENTS = new Set<InboxMetricEvent>([
  'inbox.pending.failed',
  'inbox.skipped.no_entity',
]);

type MetricGlobals = typeof globalThis & {
  __alusaInboxMetricBuckets?: Map<InboxMetricEvent, MetricBucket>;
};

function getBuckets() {
  const globalForMetrics = globalThis as MetricGlobals;
  globalForMetrics.__alusaInboxMetricBuckets ??= new Map();
  return globalForMetrics.__alusaInboxMetricBuckets;
}

export function logInboxMetric(event: InboxMetricEvent, context: Record<string, unknown>): void {
  const now = Date.now();
  const buckets = getBuckets();
  const current = buckets.get(event) ?? {
    count: 0,
    firstContext: context,
    lastEmittedAt: 0,
  };
  current.count += 1;
  buckets.set(event, current);

  const verbose = process.env.NOTIFICATION_METRICS_VERBOSE === 'true';
  const shouldEmit = verbose
    || CRITICAL_EVENTS.has(event)
    || now - current.lastEmittedAt >= EMIT_INTERVAL_MS;

  if (!shouldEmit) return;

  current.lastEmittedAt = now;
  console.info(`[Notifications][${event}]`, {
    count: current.count,
    ...(verbose ? context : current.firstContext),
  });
  current.count = 0;
  current.firstContext = context;
}
