import { describe, expect, it } from 'vitest';
import {
  PLATFORM_PLANS,
  SCHOOL_PRICE_BANDS,
  getMaxActiveStudents,
  isPlatformPlanCode,
  parsePublicCheckoutPlanCode,
} from '../src';

describe('@alusa/platform-billing plans catalog', () => {
  it('exposes only the eight approved monthly bands for new checkout', () => {
    expect(SCHOOL_PRICE_BANDS.map(({ code, amountCents }) => [code, amountCents])).toEqual([
      ['BAND_001_025', 16900], ['BAND_026_050', 22900], ['BAND_051_100', 28900], ['BAND_101_150', 34900],
      ['BAND_151_200', 41900], ['BAND_201_300', 47900], ['BAND_301_400', 55900], ['BAND_401_500', 64900],
    ]);
    expect(parsePublicCheckoutPlanCode('BAND_401_500')).toBe('BAND_401_500');
    for (const legacyCode of ['STARTER', 'PREMIUM', 'PRO', 'CUSTOM']) {
      expect(PLATFORM_PLANS[legacyCode as keyof typeof PLATFORM_PLANS].publicCheckoutEnabled).toBe(false);
      expect(() => parsePublicCheckoutPlanCode(legacyCode)).toThrow();
    }
  });

  it('keeps plan ceilings informational, never a capacity restriction', () => {
    expect(getMaxActiveStudents('BAND_001_025')).toBe(25);
    expect(getMaxActiveStudents('BAND_401_500')).toBe(500);
    expect(getMaxActiveStudents('STARTER')).toBeNull();
  });

  it('keeps old identifiers readable for existing Stripe reconciliation', () => {
    expect(isPlatformPlanCode('STARTER')).toBe(true);
    expect(isPlatformPlanCode('PREMIUM')).toBe(true);
    expect(PLATFORM_PLANS.STARTER.amountCents).toBe(14_900);
  });

  it('uses BRL monthly prices and a 14-day trial on all new bands', () => {
    for (const band of SCHOOL_PRICE_BANDS) {
      expect(PLATFORM_PLANS[band.code]).toMatchObject({ currency: 'brl', interval: 'month', trialDays: 14 });
    }
  });

  it('keeps runtime catalog values immutable', () => {
    expect(Object.isFrozen(PLATFORM_PLANS)).toBe(true);
    expect(Object.isFrozen(PLATFORM_PLANS.BAND_001_025)).toBe(true);
    expect(() => {
      (PLATFORM_PLANS.BAND_001_025 as { amountCents: number }).amountCents = 1;
    }).toThrow();
  });
});
