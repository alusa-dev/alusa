import { describe, expect, it } from 'vitest';
import {
  SCHOOL_PRICE_BANDS,
  hasBillableEnrollment,
  resolveStableSchoolPriceBand,
  resolveSchoolCommercialTarget,
  shouldApplySchoolPriceBand,
} from '../src';

describe('@alusa/platform-billing commercial model', () => {
  it('maps all approved band boundaries and prices', () => {
    expect(SCHOOL_PRICE_BANDS.map(({ minStudents, maxStudents, amountCents }) => [minStudents, maxStudents, amountCents]))
      .toEqual([[1, 25, 16900], [26, 50, 22900], [51, 100, 28900], [101, 150, 34900], [151, 200, 41900], [201, 300, 47900], [301, 400, 55900], [401, 500, 64900]]);
    expect(resolveSchoolCommercialTarget(25)?.kind).toBe('SELF_SERVICE');
    expect(resolveSchoolCommercialTarget(26)?.kind).toBe('SELF_SERVICE');
    expect(resolveSchoolCommercialTarget(500)?.kind).toBe('SELF_SERVICE');
    expect(resolveSchoolCommercialTarget(501)).toEqual({ kind: 'SPECIALIST', band: null });
    expect(resolveSchoolCommercialTarget(0)).toMatchObject({ kind: 'SELF_SERVICE', band: { code: 'BAND_001_025' } });
  });

  it('requires three consecutive monthly closes for any band change', () => {
    const currentBand = 'BAND_051_100';
    const candidateBand = 'BAND_101_150';
    expect(shouldApplySchoolPriceBand({ currentBand, candidateBand, consecutiveMonthlyCloses: 1 })).toBe(false);
    expect(shouldApplySchoolPriceBand({ currentBand, candidateBand, consecutiveMonthlyCloses: 2 })).toBe(false);
    expect(shouldApplySchoolPriceBand({ currentBand, candidateBand, consecutiveMonthlyCloses: 3 })).toBe(true);
    expect(shouldApplySchoolPriceBand({ currentBand, candidateBand: currentBand, consecutiveMonthlyCloses: 3 })).toBe(false);
  });

  it('requires three consecutive future snapshots in the same candidate band', () => {
    expect(resolveStableSchoolPriceBand({
      currentBand: 'BAND_001_025',
      snapshots: [
        { periodStart: '2026-10-01', candidateBand: 'BAND_026_050' },
        { periodStart: '2026-09-01', candidateBand: 'BAND_026_050' },
        { periodStart: '2026-08-01', candidateBand: 'BAND_026_050' },
      ],
    })).toBe('BAND_026_050');
    expect(resolveStableSchoolPriceBand({
      currentBand: 'BAND_001_025',
      snapshots: [
        { periodStart: '2026-10-01', candidateBand: 'BAND_026_050' },
        { periodStart: '2026-08-01', candidateBand: 'BAND_026_050' },
        { periodStart: '2026-07-01', candidateBand: 'BAND_026_050' },
      ],
    })).toBeNull();
  });

  it('counts only effective active monthly enrollment with a positive amount', () => {
    const eligible = { active: true, effective: true, cycleAmountCents: 10000, fullScholarship: false };
    expect(hasBillableEnrollment(eligible)).toBe(true);
    expect(hasBillableEnrollment({ ...eligible, fullScholarship: true })).toBe(false);
    expect(hasBillableEnrollment({ ...eligible, cycleAmountCents: 0 })).toBe(false);
    expect(hasBillableEnrollment({ ...eligible, effective: false })).toBe(false);
  });
});
