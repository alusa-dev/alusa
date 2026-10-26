import { describe, expect, it } from 'vitest';
import {
  SCHOOL_PRICE_BANDS,
  getSchoolPriceBandRank,
} from '@alusa/platform-billing/commercial-model';
import { getPlanRank } from '../PlatformBillingFeature';
import { getPlatformPlanRank } from '@/src/server/platform-billing/plan-change-actions';

describe('platform billing plan classification', () => {
  it('uses the same canonical ordering for server plan changes and UI', () => {
    for (const [index, band] of SCHOOL_PRICE_BANDS.entries()) {
      const canonicalRank = getSchoolPriceBandRank(band.code);
      expect(canonicalRank).toBe(index + 1);
      expect(getPlatformPlanRank(band.code)).toBe(canonicalRank);
      expect(getPlanRank(band.code)).toBe(canonicalRank);
    }
  });

  it('keeps legacy identifiers in a separate explicit rank mapping', () => {
    for (const code of ['STARTER', 'PREMIUM', 'PRO', 'CUSTOM'] as const) {
      expect(getPlatformPlanRank(code)).toBe(getPlanRank(code));
    }
  });
});
