import { describe, expect, it, vi } from 'vitest';
import { calculateCustomInvitationMonthlyAmountCents, resolvePlatformBillingCheckoutPlan } from '../src';

const context = {
  activeStudents: 120,
  billingPlanCode: null,
  billingStatus: null,
  billingAccessStatus: null,
  onboardingPricing: null,
  recentSnapshots: [],
};

describe('resolvePlatformBillingCheckoutPlan', () => {
  it('calculates custom monthly overage only above the included students', () => {
    const terms = { baseMonthlyAmountCents: 20_000, includedStudentCount: 25, monthlyPerStudentOverageCents: 250, studentCount: 30 };
    expect(calculateCustomInvitationMonthlyAmountCents({ ...terms, studentCount: 20 })).toBe(20_000);
    expect(calculateCustomInvitationMonthlyAmountCents(terms)).toBe(21_250);
    expect(calculateCustomInvitationMonthlyAmountCents({ ...terms, studentCount: Number.MAX_SAFE_INTEGER })).toBeNull();
  });
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

  it('preserves a customized invitation Price rather than recalculating a public band', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, activeStudents: 75, acceptedInvitation: { conditionType: 'CUSTOM', stripePriceId: 'price_custom_123', studentCount: 75 } }),
    });
    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'CUSTOM', currentBand: null, studentCount: 75, stripePriceId: 'price_custom_123' });
  });

  it('recalculates a standard invitation band from the saved adjustable estimate before Stripe checkout', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({
        ...context,
        activeStudents: 320,
        onboardingPricing: { wizardCompletedAt: new Date(), onboardingStudentCount: 100 },
        acceptedInvitation: { conditionType: 'STANDARD', stripePriceId: null, studentCount: 20 },
      }),
    });
    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'BAND_051_100', currentBand: null, studentCount: 100 });
  });

  it('keeps an accepted custom invitation above 500 on its versioned Price', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, activeStudents: 501, acceptedInvitation: { conditionType: 'CUSTOM', stripePriceId: 'price_custom_123', studentCount: 501 } }),
    });
    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'CUSTOM', currentBand: null, studentCount: 501, stripePriceId: 'price_custom_123' });
  });

  it('resolves a canceled legacy account from its current effective student count', async () => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({
        ...context,
        billingPlanCode: 'PREMIUM',
        billingStatus: 'CANCELED',
        billingAccessStatus: 'CANCELED',
      }),
    });

    expect(result).toEqual({ kind: 'RESOLVED', planCode: 'BAND_101_150', currentBand: null, studentCount: 120 });
  });

  it('keeps non-canceled legacy accounts blocked and public canceled tiers intact', async () => {
    const nonCanceledLegacy = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, billingPlanCode: 'PREMIUM', billingStatus: 'ACTIVE', billingAccessStatus: 'ACTIVE' }),
    });
    const publicCanceledTier = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({
        ...context,
        billingPlanCode: 'BAND_151_200',
        billingStatus: 'CANCELED',
        billingAccessStatus: 'CANCELED',
      }),
    });

    expect(nonCanceledLegacy).toEqual({ kind: 'UNSTABLE' });
    expect(publicCanceledTier).toEqual({
      kind: 'RESOLVED', planCode: 'BAND_151_200', currentBand: 'BAND_151_200', studentCount: 120,
    });
  });

  it.each([
    { billingStatus: 'CANCELED', billingAccessStatus: 'ACTIVE' },
    { billingStatus: 'ACTIVE', billingAccessStatus: 'CANCELED' },
  ])('keeps legacy plans blocked when terminal statuses diverge (%s)', async (statuses) => {
    const result = await resolvePlatformBillingCheckoutPlan({
      loadContext: async () => ({ ...context, billingPlanCode: 'PREMIUM', ...statuses }),
    });

    expect(result).toEqual({ kind: 'UNSTABLE' });
  });
});
