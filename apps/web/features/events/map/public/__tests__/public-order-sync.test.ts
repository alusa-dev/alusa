import { describe, expect, it } from 'vitest';
import { updatePublicOrderIfCurrent } from '../public-order-sync';

describe('updatePublicOrderIfCurrent', () => {
  it('ignores a sync response after checkout has moved to a different order', () => {
    const newerOrder = { orderId: 'order-new', status: 'PAYMENT_PENDING' };

    expect(updatePublicOrderIfCurrent(newerOrder, 'order-old', () => ({
      ...newerOrder,
      status: 'CONFIRMED',
    }))).toBe(newerOrder);
  });

  it('applies a sync response to the matching order', () => {
    const order = { orderId: 'order-current', status: 'PAYMENT_PENDING' };

    expect(updatePublicOrderIfCurrent(order, 'order-current', (current) => ({
      ...current,
      status: 'CONFIRMED',
    }))).toEqual({ orderId: 'order-current', status: 'CONFIRMED' });
  });
});
