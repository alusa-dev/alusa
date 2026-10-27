import { describe, expect, it, vi } from 'vitest';
import { resolvePlatformBillingCheckoutPlan } from '../src';

const context = {
  activeStudents: 120,
  billingPlanCode: null,
  onboardingPricing: null,
  recentSnapshots: [],
};

describe('resolvePlatformBillingCheckoutPlan', () => {
  it('uses the effective server-side student count rather than a browser-selected count', async () => {
    const loadContext = vi.fn(async () => context);
    const result = await resolvePlatformBillingCheckoutPlan({ loadContext });

    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'BAND_101_150', currentBand: null, studentCount: 120 });
    expect(loadContext).toHaveBeenCalledOnce();
  });

  it('falls back to completed onboarding pricing, then to live enrollment count', async () => {
    const onboardingResult = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({
        ...context,
        activeStudents: 0,
        onboardingPricing: { wizardCompletedAt: new Date(), onboardingStudentCount: 30 },
      }),
    });
    const enrollmentResult = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, activeStudents: 80 }),
    });

    expect(onboardingResult).toMatchObject({ kind: 'RESOLVED', planCode: 'BAND_026_050', studentCount: 30 });
    expect(enrollmentResult).toMatchObject({ kind: 'RESOLVED', planCode: 'BAND_051_100', studentCount: 80 });
  });

  it('keeps the current confirmed band even when the live count enters another band', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, activeStudents: 10, billingPlanCode: 'BAND_151_200' }),
    });

    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'BAND_151_200', currentBand: 'BAND_151_200', studentCount: 10 });
  });

  it('routes a stable specialist state and an over-limit fallback to the corresponding outcomes', async () => {
    const confirmedSpecialist = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({
        ...context,
        recentSnapshots: [
          { periodStart: new Date('2026-10-01'), candidateBand: 'SPECIALIST' },
          { periodStart: new Date('2026-09-01'), candidateBand: 'SPECIALIST' },
          { periodStart: new Date('2026-08-01'), candidateBand: 'SPECIALIST' },
        ],
      }),
    });
    const overLimit = await resolvePlatformBillingCheckoutPlan({ loadContext: async () => ({ ...context, activeStudents: 501 }) });

    expect(confirmedSpecialist).toEqual({ kind: 'SPECIALIST', reason: 'CONFIRMED_SPECIALIST' });
    expect(overLimit).toEqual({ kind: 'SPECIALIST', reason: 'COUNT_ABOVE_SELF_SERVICE', studentCount: 501 });
  });

  it('blocks legacy plan codes until their commercial state is reconciled', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, billingPlanCode: 'PREMIUM' }),
    });

    expect(result).toEqual({ kind: 'UNSTABLE' });
  });
});
