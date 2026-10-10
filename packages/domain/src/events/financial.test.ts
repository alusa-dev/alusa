import { describe, expect, it } from 'vitest';

import {
  calculateEventParticipantDiscount,
  normalizeEventFinancialLine,
  normalizeEventFinancialPayment,
  calculateEventCostPayment,
  supportsEventCostPaymentOrigin,
} from './financial';

describe('event financial canonical rules', () => {
  it('allows payment tracking for manual costs and costume purchases, but not recognized losses', () => {
    expect(supportsEventCostPaymentOrigin('MANUAL')).toBe(true);
    expect(supportsEventCostPaymentOrigin('COSTUME', 'costume-1')).toBe(true);
    expect(supportsEventCostPaymentOrigin('COSTUME')).toBe(false);
    expect(supportsEventCostPaymentOrigin('COSTUME', 'loss:assignment-1')).toBe(false);
    expect(supportsEventCostPaymentOrigin('COSTUME_ASSIGNMENT', 'assignment-1')).toBe(false);
  });

  it('allows a partial cost payment and then a final payment, but rejects above balance', () => {
    const partial = calculateEventCostPayment({ expectedAmount: 100, paidAmount: 0, paymentAmount: 35 });
    expect(partial).toEqual({ balance: 100, totalPaid: 35, remaining: 65, status: 'PARTIALLY_PAID' });
    const final = calculateEventCostPayment({ expectedAmount: 100, paidAmount: partial.totalPaid, paymentAmount: 65 });
    expect(final).toEqual({ balance: 65, totalPaid: 100, remaining: 0, status: 'PAID' });
    expect(() => calculateEventCostPayment({ expectedAmount: 100, paidAmount: 75, paymentAmount: 26 })).toThrow();
  });
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
