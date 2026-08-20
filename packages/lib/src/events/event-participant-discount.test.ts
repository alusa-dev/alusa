import { describe, expect, it } from 'vitest';

import { calculateEventParticipantDiscount } from './event-participant-discount';

describe('event participant discount', () => {
  it('calculates a fixed discount and preserves the net amount', () => {
    expect(calculateEventParticipantDiscount({
      originalAmount: 780,
      discountType: 'FIXED',
      discountValue: 55,
    })).toEqual({ originalAmount: 780, discountAmount: 55, chargedAmount: 725 });
  });

  it('rounds percentage discounts to cents', () => {
    expect(calculateEventParticipantDiscount({
      originalAmount: 780,
      discountType: 'PERCENTAGE',
      discountValue: 7.05,
    })).toEqual({ originalAmount: 780, discountAmount: 54.99, chargedAmount: 725.01 });
  });
});
