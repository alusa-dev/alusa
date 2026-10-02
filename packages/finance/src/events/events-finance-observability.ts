import { logFinanceOperationalEvent } from '../foundation/operational-log';

type EventsFinanceEventName = Extract<
  import('../foundation/operational-log').FinanceOperationalEventName,
  `finance.events.${string}`
>;

export type EventFinanceLogPayload = {
  processed?: number;
  skipped?: number;
  errors?: number;
  error?: unknown;
};

export function logEventsFinance(
  eventName: EventsFinanceEventName,
  payload: EventFinanceLogPayload = {},
  severity: 'info' | 'warn' | 'error' = 'info',
) {
  logFinanceOperationalEvent({
    eventName,
    severity,
    itemCount: payload.processed,
    skippedCount: payload.skipped,
    errorCount: payload.errors,
    error: payload.error,
    result:
      payload.errors !== undefined
        ? payload.errors > 0
          ? 'partial_failure'
          : 'success'
        : severity === 'info'
          ? undefined
          : 'partial_failure',
    throttleMs: 60_000,
  });
}
