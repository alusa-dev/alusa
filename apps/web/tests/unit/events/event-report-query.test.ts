import { describe, expect, it } from 'vitest';

import { EventApiError } from '@/features/events/events-service';
import { shouldRetryEventReportQuery } from '@/features/events/reports/event-report-query';

describe('shouldRetryEventReportQuery', () => {
  it('does not immediately retry a rate-limited report request', () => {
    expect(shouldRetryEventReportQuery(0, new EventApiError('rate limited', {
      code: 'RATE_LIMITED',
      status: 429,
    }))).toBe(false);
  });

  it('keeps the bounded default retry behavior for other report failures', () => {
    expect(shouldRetryEventReportQuery(0, new EventApiError('server error', { status: 500 }))).toBe(true);
    expect(shouldRetryEventReportQuery(2, new Error('network error'))).toBe(true);
    expect(shouldRetryEventReportQuery(3, new Error('network error'))).toBe(false);
  });
});
