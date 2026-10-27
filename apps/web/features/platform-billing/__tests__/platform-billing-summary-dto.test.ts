import { describe, expect, it } from 'vitest';
import { publicPlatformPlanDTOSchema } from '../dtos/platform-billing-summary';

const validPlan = {
  code: 'BAND_001_025',
  name: '1 a 25 alunos',
  amountCents: 16_900,
  currency: 'brl',
  interval: 'month',
  trialDays: 14,
  minActiveStudents: 1,
  maxActiveStudents: 25,
  publicCheckoutEnabled: true,
  includedFeatures: ['Alusa completa'],
} as const;

describe('publicPlatformPlanDTOSchema', () => {
  it('aceita um plano público completo', () => {
    expect(publicPlatformPlanDTOSchema.parse(validPlan)).toMatchObject({
      code: 'BAND_001_025',
      trialDays: 14,
      minActiveStudents: 1,
      maxActiveStudents: 25,
    });
  });

  it('rejeita plano sem duração do período de teste', () => {
    const { trialDays: _trialDays, ...missingTrialDays } = validPlan;

    expect(publicPlatformPlanDTOSchema.safeParse(missingTrialDays).success).toBe(false);
  });

  it('rejeita duração nula, indefinida ou não positiva', () => {
    for (const trialDays of [null, undefined, 0, -1]) {
      expect(publicPlatformPlanDTOSchema.safeParse({ ...validPlan, trialDays }).success).toBe(false);
    }
  });
});
