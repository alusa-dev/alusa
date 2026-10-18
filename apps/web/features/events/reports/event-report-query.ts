import { EventApiError } from '../events-service';

export function shouldRetryEventReportQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof EventApiError && error.status === 429) return false;
  return failureCount < 3;
}
