import { describe, expect, it } from 'vitest';
import { SCHOOL_PRICE_BANDS } from '@alusa/platform-billing/commercial-model';
import { getSchoolPricingTier, SCHOOL_PRICING_TIERS } from '@/lib/school-pricing-ui';

describe('school pricing UI catalog', () => {
  it('uses the canonical billing bands, boundaries, labels, and BRL amounts', () => {
    expect(SCHOOL_PRICING_TIERS).toEqual(SCHOOL_PRICE_BANDS.map((band) => ({
      code: band.code,
      min: band.minStudents,
      max: band.maxStudents,
      label: band.label,
      price: band.amountCents / 100,
    })));

    for (const band of SCHOOL_PRICE_BANDS) {
      expect(getSchoolPricingTier(band.minStudents)).toMatchObject({ code: band.code, price: band.amountCents / 100 });
      expect(getSchoolPricingTier(band.maxStudents)).toMatchObject({ code: band.code, price: band.amountCents / 100 });
    }
  });
});
