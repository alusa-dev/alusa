import { describe, expect, it } from 'vitest';

import {
  shouldContinueQueryPolling,
  shouldRefetchQueryOnWindowFocus,
  shouldRetryQueryOnce,
} from '@/lib/query/query-error-policy';

describe('shared query HTTP 429 policy', () => {
  it('does not retry, refetch by focus, or poll while the current error is HTTP 429', () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 });

    expect(shouldRetryQueryOnce(0, error)).toBe(false);
    expect(shouldRefetchQueryOnWindowFocus(error)).toBe(false);
    expect(shouldContinueQueryPolling(error)).toBe(false);
  });

  it('preserves one retry and refetch behavior for other errors and non-error states', () => {
    const serverError = Object.assign(new Error('server error'), { status: 500 });

    expect(shouldRetryQueryOnce(0, serverError)).toBe(true);
    expect(shouldRetryQueryOnce(1, serverError)).toBe(false);
    expect(shouldRefetchQueryOnWindowFocus(serverError)).toBe(true);
    expect(shouldContinueQueryPolling(serverError)).toBe(true);
    expect(shouldRetryQueryOnce(0, new Error('network error'))).toBe(true);
    expect(shouldRefetchQueryOnWindowFocus(new Error('network error'))).toBe(true);
    expect(shouldContinueQueryPolling(new Error('network error'))).toBe(true);
    expect(shouldRefetchQueryOnWindowFocus(null)).toBe(true);
  });
});
