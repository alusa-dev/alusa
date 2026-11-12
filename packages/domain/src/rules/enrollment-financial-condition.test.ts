import { describe, expect, it } from 'vitest';
import { calculateEnrollmentFinancialCondition, isEnrollmentBenefitValidityInRange } from './enrollment-financial-condition';

describe('enrollment financial condition', () => {
  it('rounds a half-cent benefit once before subtracting it', () => {
    expect(calculateEnrollmentFinancialCondition(10.03, { condicaoFinanceira: 'BOLSA_PARCIAL', condicaoPercentual: 50 }))
      .toEqual({ baseAmount: 10.03, benefitAmount: 5.02, monthlyAmount: 5.01 });
  });
  it.each([0, 10.03, 99.99, 150])('preserves gross = benefit + net in cents for %s', (base) => {
    for (const percentage of [1, 25, 50, 99, 99.99]) {
      const price = calculateEnrollmentFinancialCondition(base, { condicaoFinanceira: 'BOLSA_PARCIAL', condicaoPercentual: percentage });
      expect(Math.round(price.monthlyAmount * 100) + Math.round(price.benefitAmount * 100)).toBe(Math.round(base * 100));
    }
  });
  it('exempts the monthly amount without requiring a percentage', () => {
    expect(calculateEnrollmentFinancialCondition(150, { condicaoFinanceira: 'ISENCAO_INTEGRAL' }).monthlyAmount).toBe(0);
    expect(calculateEnrollmentFinancialCondition(150, { condicaoFinanceira: 'NORMAL' }).monthlyAmount).toBe(150);
  });
  it.each(['2026-12-31', '2028-01-01', '2027-02-30'])('rejects invalid or out of contract validity: %s', (date) => {
    expect(isEnrollmentBenefitValidityInRange(date, '2027-01-01', '2027-12-31')).toBe(false);
  });
  it.each(['2027-01-01', '2027-06-30', '2027-12-31'])('accepts inclusive contract bounds: %s', (date) => {
    expect(isEnrollmentBenefitValidityInRange(date, '2027-01-01', '2027-12-31')).toBe(true);
  });
});
