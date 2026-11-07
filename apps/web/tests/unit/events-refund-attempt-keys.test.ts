import { describe, expect, it } from 'vitest';
import { RefundAttemptKeys } from '@/features/events/refund-attempt-keys';

describe('RefundAttemptKeys', () => {
  it('reuses keys for ambiguous retries and rotates after definitive failure', () => {
    const attempts = new RefundAttemptKeys();
    const first = attempts.get('order-1');
    expect(attempts.get('order-1')).toBe(first);

    attempts.fail('order-1', { status: 500 });
    expect(attempts.get('order-1')).toBe(first);
    attempts.fail('order-1', { status: 408 });
    expect(attempts.get('order-1')).toBe(first);

    attempts.fail('order-1', { status: 429 });
    const retry = attempts.get('order-1');
    expect(retry).not.toBe(first);
    expect(attempts.get('order-1')).toBe(retry);

    attempts.fail('order-1', { status: 425 });
    expect(attempts.get('order-1')).not.toBe(retry);
  });

  it('uses separate keys per order and clears a completed attempt', () => {
    const attempts = new RefundAttemptKeys();
    const orderOne = attempts.get('order-1');
    expect(attempts.get('order-2')).not.toBe(orderOne);
    attempts.complete('order-1');
    expect(attempts.get('order-1')).not.toBe(orderOne);
  });
});
