export interface EnrollmentFinancialCondition {
  condicaoFinanceira?: string;
  condicaoPercentual?: number | null;
}

/** Round the benefit once, in cents, before subtracting it from the plan. */
export function calculateEnrollmentFinancialCondition(base: number, condition: EnrollmentFinancialCondition) {
  const baseCents = Math.round(Math.max(0, Number.isFinite(base) ? base : 0) * 100);
  const percentage = condition.condicaoFinanceira === 'ISENCAO_INTEGRAL'
    ? 100
    : condition.condicaoFinanceira === 'BOLSA_PARCIAL'
      ? Math.max(0, Math.min(99.99, Number(condition.condicaoPercentual) || 0))
      : 0;
  const basisPoints = Math.round(percentage * 100);
  const benefitCents = Math.round(baseCents * basisPoints / 10000);
  return {
    baseAmount: baseCents / 100,
    benefitAmount: benefitCents / 100,
    monthlyAmount: (baseCents - benefitCents) / 100,
  };
}

export function isEnrollmentBenefitValidityInRange(validUntil: string, startsAt?: string, endsAt?: string) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(validUntil)
    && Number.isFinite(Date.parse(`${validUntil}T00:00:00Z`))
    && new Date(`${validUntil}T00:00:00Z`).toISOString().slice(0, 10) === validUntil;
  return validDate && (!startsAt || validUntil >= startsAt.slice(0, 10))
    && (!endsAt || validUntil <= endsAt.slice(0, 10));
}
