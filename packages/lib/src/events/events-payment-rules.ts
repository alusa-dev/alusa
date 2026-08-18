export const EVENT_PAYMENT_RULE_TYPES = ['FIXED', 'PERCENTAGE'] as const;

export type EventPaymentRuleType = (typeof EVENT_PAYMENT_RULE_TYPES)[number];

export type EventPaymentRulesInput = {
  interestPercent?: number | null;
  fine?: {
    value: number;
    type: EventPaymentRuleType;
  } | null;
  discount?: {
    value: number;
    type: EventPaymentRuleType;
    dueDateLimitDays: number;
  } | null;
} | null;

export type EventPaymentRules = {
  interestPercent: number | null;
  fine: {
    value: number;
    type: EventPaymentRuleType;
  } | null;
  discount: {
    value: number;
    type: EventPaymentRuleType;
    dueDateLimitDays: number;
  } | null;
};

export type EventPaymentRulesPersistence = {
  paymentInterestValue: number | null;
  paymentFineValue: number | null;
  paymentFineType: EventPaymentRuleType | null;
  paymentDiscountValue: number | null;
  paymentDiscountType: EventPaymentRuleType | null;
  paymentDiscountDueDateLimitDays: number | null;
};

function positiveOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeEventPaymentRules(input?: EventPaymentRulesInput): EventPaymentRules | null {
  const interestPercent = positiveOrNull(input?.interestPercent);
  const fineValue = positiveOrNull(input?.fine?.value);
  const discountValue = positiveOrNull(input?.discount?.value);

  const fine = fineValue == null || !input?.fine
    ? null
    : { value: fineValue, type: input.fine.type };

  const discount = discountValue == null || !input?.discount
    ? null
    : {
        value: discountValue,
        type: input.discount.type,
        dueDateLimitDays: Math.max(0, Math.trunc(input.discount.dueDateLimitDays)),
      };

  if (interestPercent == null && fine == null && discount == null) return null;
  return { interestPercent, fine, discount };
}

export function eventPaymentRulesToPersistence(
  rules: EventPaymentRules | null,
): EventPaymentRulesPersistence {
  return {
    paymentInterestValue: rules?.interestPercent ?? null,
    paymentFineValue: rules?.fine?.value ?? null,
    paymentFineType: rules?.fine?.type ?? null,
    paymentDiscountValue: rules?.discount?.value ?? null,
    paymentDiscountType: rules?.discount?.type ?? null,
    paymentDiscountDueDateLimitDays: rules?.discount?.dueDateLimitDays ?? null,
  };
}

export function eventPaymentRulesFromRecord(record: {
  paymentInterestValue?: unknown;
  paymentFineValue?: unknown;
  paymentFineType?: string | null;
  paymentDiscountValue?: unknown;
  paymentDiscountType?: string | null;
  paymentDiscountDueDateLimitDays?: number | null;
}): EventPaymentRules | null {
  const interestPercent = positiveOrNull(Number(record.paymentInterestValue ?? 0));
  const fineValue = positiveOrNull(Number(record.paymentFineValue ?? 0));
  const discountValue = positiveOrNull(Number(record.paymentDiscountValue ?? 0));
  const fineType = EVENT_PAYMENT_RULE_TYPES.includes(record.paymentFineType as EventPaymentRuleType)
    ? (record.paymentFineType as EventPaymentRuleType)
    : 'PERCENTAGE';
  const discountType = EVENT_PAYMENT_RULE_TYPES.includes(record.paymentDiscountType as EventPaymentRuleType)
    ? (record.paymentDiscountType as EventPaymentRuleType)
    : 'PERCENTAGE';

  const rules = normalizeEventPaymentRules({
    interestPercent,
    fine: fineValue == null ? null : { value: fineValue, type: fineType },
    discount:
      discountValue == null
        ? null
        : {
            value: discountValue,
            type: discountType,
            dueDateLimitDays: record.paymentDiscountDueDateLimitDays ?? 0,
          },
  });

  return rules;
}

export function eventPaymentRulesToAsaas(rules: EventPaymentRules | null) {
  if (!rules) return {};

  return {
    ...(rules.interestPercent != null ? { interest: { value: rules.interestPercent } } : {}),
    ...(rules.fine ? { fine: rules.fine } : {}),
    ...(rules.discount ? { discount: rules.discount } : {}),
  };
}

export function validateEventPaymentRulesForCharge(
  rules: EventPaymentRules | null,
  chargeValue: number,
): string | null {
  if (!rules || !Number.isFinite(chargeValue) || chargeValue <= 0) return null;
  if (rules.discount?.type === 'FIXED' && rules.discount.value > chargeValue) {
    return 'O desconto fixo não pode ser maior que o valor da cobrança.';
  }
  if (rules.discount?.type === 'PERCENTAGE' && rules.discount.value > 100) {
    return 'O desconto percentual não pode ser maior que 100%.';
  }
  if (rules.fine?.type === 'FIXED' && rules.fine.value > chargeValue) {
    return 'A multa fixa não pode ser maior que o valor da cobrança.';
  }
  return null;
}
