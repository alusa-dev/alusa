import { describe, expect, it } from 'vitest';

import {
  calculateEventParticipantDiscount,
  normalizeEventFinancialLine,
  normalizeEventFinancialPayment,
} from './financial';

describe('event financial canonical rules', () => {
  it('calculates fixed and percentage discounts in cents', () => {
    expect(calculateEventParticipantDiscount({
      originalAmount: 780,
      discountType: 'FIXED',
      discountValue: 11515.5,
      quantity: 27,
    })).toEqual({
      grossAmount: 21060,
      discountAmount: 11515.5,
      netAmount: 9544.5,
    });

    expect(calculateEventParticipantDiscount({
      originalAmount: 780,
      discountType: 'PERCENTAGE',
      discountValue: 10,
    })).toEqual({
      grossAmount: 780,
      discountAmount: 78,
      netAmount: 702,
    });
  });

  it('rejects a financial line whose net value does not reconcile', () => {
    expect(() => normalizeEventFinancialLine({
      grossAmount: 100,
      discountAmount: 20,
      expectedAmount: 90,
    })).toThrow('valor bruto menos o desconto');
  });

  it('allows costs above budget but limits revenue and refunds', () => {
    expect(normalizeEventFinancialPayment({
      actualAmount: 120,
      expectedAmount: 100,
      enforceExpectedLimit: false,
    }).netAmount).toBe(120);

    expect(() => normalizeEventFinancialPayment({
      actualAmount: 120,
      expectedAmount: 100,
      enforceExpectedLimit: true,
    })).toThrow('maior que o valor esperado');

    expect(() => normalizeEventFinancialPayment({
      actualAmount: 100,
      refundedAmount: 101,
    })).toThrow('maior que o valor recebido');
  });
});
