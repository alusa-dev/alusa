import { describe, expect, it } from 'vitest';

import {
  eventPaymentRulesToAsaas,
  eventPaymentRulesToPersistence,
  normalizeEventPaymentRules,
  validateEventPaymentRulesForCharge,
} from './events-payment-rules';

describe('event payment rules', () => {
  it('normalizes an empty configuration to null', () => {
    expect(normalizeEventPaymentRules({
      interestPercent: 0,
      fine: { value: 0, type: 'PERCENTAGE' },
      discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 0 },
    })).toBeNull();
  });

  it('creates a persistence shape and an Asaas payload', () => {
    const rules = normalizeEventPaymentRules({
      interestPercent: 1,
      fine: { value: 2, type: 'PERCENTAGE' },
      discount: { value: 10, type: 'FIXED', dueDateLimitDays: 5 },
    });

    expect(rules).toEqual({
      interestPercent: 1,
      fine: { value: 2, type: 'PERCENTAGE' },
      discount: { value: 10, type: 'FIXED', dueDateLimitDays: 5 },
    });
    expect(eventPaymentRulesToPersistence(rules)).toEqual({
      paymentInterestValue: 1,
      paymentFineValue: 2,
      paymentFineType: 'PERCENTAGE',
      paymentDiscountValue: 10,
      paymentDiscountType: 'FIXED',
      paymentDiscountDueDateLimitDays: 5,
    });
    expect(eventPaymentRulesToAsaas(rules)).toEqual({
      interest: { value: 1 },
      fine: { value: 2, type: 'PERCENTAGE' },
      discount: { value: 10, type: 'FIXED', dueDateLimitDays: 5 },
    });
  });

  it('rejects fixed discounts and fines above the charged amount', () => {
    expect(validateEventPaymentRulesForCharge(
      normalizeEventPaymentRules({
        discount: { value: 101, type: 'FIXED', dueDateLimitDays: 0 },
      }),
      100,
    )).toBe('O desconto fixo não pode ser maior que o valor da cobrança.');

    expect(validateEventPaymentRulesForCharge(
      normalizeEventPaymentRules({
        fine: { value: 101, type: 'FIXED' },
      }),
      100,
    )).toBe('A multa fixa não pode ser maior que o valor da cobrança.');
  });

  it('does not produce an Asaas rule when the event has no custom configuration', () => {
    expect(eventPaymentRulesToAsaas(null)).toEqual({});
  });
});
