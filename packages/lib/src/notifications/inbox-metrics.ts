export type InboxMetricEvent =
  | 'inbox.created'
  | 'inbox.deduped'
  | 'inbox.skipped.no_recipients'
  | 'inbox.skipped.no_entity'
  | 'inbox.skipped.unsupported_event'
  | 'inbox.pending.enqueued'
  | 'inbox.pending.processed'
  | 'inbox.pending.failed'
  | 'inbox.overdue.emitted'
  | 'inbox.overdue.skipped';

export function logInboxMetric(event: InboxMetricEvent, context: Record<string, unknown>): void {
  console.info(`[Notifications][${event}]`, context);
}
