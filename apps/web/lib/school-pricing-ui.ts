import { SCHOOL_PRICE_BANDS } from '@alusa/platform-billing/commercial-model';

export const SCHOOL_PRICING_TIERS = SCHOOL_PRICE_BANDS.map((band) => ({
  code: band.code,
  min: band.minStudents,
  max: band.maxStudents,
  label: band.label,
  price: band.amountCents / 100,
}));

export function getSchoolPricingTier(students: number) {
  return SCHOOL_PRICING_TIERS.find((tier) => students >= tier.min && students <= tier.max);
}
