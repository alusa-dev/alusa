import { logLibOperationalEvent } from '../observability/operational-log';

export type InboxMetricEvent =
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

export function logInboxMetric(event: InboxMetricEvent, context: Record<string, unknown>): void {
  logLibOperationalEvent({
    eventName: event,
    severity: event.includes('.failed') ? 'error' : event.startsWith('inbox.skipped.') ? 'warn' : 'info',
    failureReason:
      context.failureReason === 'entity_missing' ||
      context.failureReason === 'payload_integrity' ||
      context.failureReason === 'retry_exhausted'
        ? context.failureReason
        : undefined,
  });
}
