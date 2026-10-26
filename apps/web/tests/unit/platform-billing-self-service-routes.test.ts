import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { state, checkoutMock, trialMock, portalMock, logApiOperationalEventMock, tenantContext } = vi.hoisted(() => {
  const state = {
    activeStudents: 500,
    declaredStudents: null as number | null,
    planCode: null as string | null,
    snapshots: [] as Array<{ periodStart: Date; candidateBand: string | null }>,
    billingStatus: 'ACTIVE' as string,
    trialEndsAt: null as Date | null,
    firstPaidAt: null as Date | null,
    lastSuccessfulPaymentAt: null as Date | null,
    tenantSessionError: null as Error | null,
  };
  const checkoutMock = vi.fn(async () => ({ checkoutSessionId: 'cs_1', checkoutUrl: 'https://checkout.test', reused: false }));
  const trialMock = vi.fn(async () => ({ billingAccountId: 'account_1', stripeSubscriptionId: 'sub_1', trialEndsAt: new Date('2030-01-15T00:00:00Z'), reused: false }));
  const portalMock = vi.fn(async () => ({ billingAccountId: 'account_1', portalSessionId: 'bps_1', portalUrl: 'https://billing.test' }));
  const logApiOperationalEventMock = vi.fn();
  const tenantContext = {
    contaId: 'conta_a',
    userId: 'admin_a',
    tx: {
      conta: { findFirst: vi.fn(async () => ({ id: 'conta_a' })) },
      financeProfile: { findUnique: vi.fn(async () => state.declaredStudents === null ? null : {
        wizardCompletedAt: new Date('2030-01-01T00:00:00Z'), onboardingStudentCount: state.declaredStudents,
      }) },
      platformBillingAccount: { findUnique: vi.fn(async () => state.planCode || state.trialEndsAt ? {
        planCode: state.planCode,
        status: state.billingStatus,
        trialEndsAt: state.trialEndsAt,
        firstPaidAt: state.firstPaidAt,
        lastSuccessfulPaymentAt: state.lastSuccessfulPaymentAt,
      } : null) },
      platformBillingMonthlySnapshot: { findMany: vi.fn(async () => state.snapshots) },
    },
  };
  return { state, checkoutMock, trialMock, portalMock, logApiOperationalEventMock, tenantContext };
});

vi.mock('@alusa/stripe', () => ({ StripeIntegrationError: class StripeIntegrationError extends Error {} }));
vi.mock('@alusa/platform-billing', () => ({
  PlatformBillingError: class PlatformBillingError extends Error {},
  createPlatformBillingCheckoutSession: checkoutMock,
  createPlatformBillingTrialWithoutPaymentMethod: trialMock,
  createPlatformBillingPortalSession: portalMock,
  createPrismaPlatformBillingStore: vi.fn(() => ({})),
  isPublicPlatformPlanCode: (value: unknown) => typeof value === 'string' && value.startsWith('BAND_'),
  isSchoolPriceBandCode: (value: unknown) => typeof value === 'string' && value.startsWith('BAND_'),
  resolveStableSchoolPriceBand: ({ currentBand, snapshots }: {
    currentBand: string | null;
    snapshots: Array<{ candidateBand: string | null }>;
  }) => {
    const latest = snapshots.slice(0, 3);
    if (latest.length < 3) return null;
    const candidateBand = latest[0]?.candidateBand;
    return latest.every((snapshot) => snapshot.candidateBand === candidateBand) && candidateBand !== currentBand
      ? candidateBand
      : null;
  },
  resolveSchoolCommercialTarget: (count: number) => {
    if (!Number.isSafeInteger(count) || count < 0) return null;
    if (count > 500) return { kind: 'SPECIALIST', band: null };
    const code = count > 400 ? 'BAND_401_500'
      : count > 300 ? 'BAND_301_400'
        : count > 200 ? 'BAND_201_300'
          : count > 150 ? 'BAND_151_200'
            : count > 100 ? 'BAND_101_150'
              : count > 50 ? 'BAND_051_100'
                : count > 25 ? 'BAND_026_050' : 'BAND_001_025';
    return { kind: 'SELF_SERVICE', band: { code } };
  },
  resolvePlatformBillingCheckoutPlan: async (
    input: { requestedStudentCount?: number },
    deps: { loadContext: () => Promise<{
      activeStudents: number;
      billingPlanCode: string | null;
      onboardingPricing: { wizardCompletedAt: Date | null; onboardingStudentCount: number | null } | null;
      recentSnapshots: Array<{ periodStart: Date; candidateBand: string | null }>;
    }> },
  ) => {
    const context = await deps.loadContext();
    const declared = context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount
      ? context.onboardingPricing.onboardingStudentCount
      : null;
    const currentBand = typeof context.billingPlanCode === 'string' && context.billingPlanCode.startsWith('BAND_')
      ? context.billingPlanCode
      : null;
    const latestSnapshots = context.recentSnapshots.slice(0, 3);
    const candidateBand = latestSnapshots[0]?.candidateBand;
    const stableBand = latestSnapshots.length === 3 && candidateBand &&
      latestSnapshots.every((snapshot) => snapshot.candidateBand === candidateBand) && candidateBand !== currentBand
      ? candidateBand
      : null;
    if (stableBand === 'SPECIALIST') {
      return { kind: 'SPECIALIST', reason: 'CONFIRMED_SPECIALIST' };
    }
    if (currentBand) return { kind: 'RESOLVED', planCode: currentBand, currentBand };
    const studentCount = input.requestedStudentCount ?? declared ?? context.activeStudents;
    const target = studentCount > 500 ? { kind: 'SPECIALIST' as const, band: null } : {
      kind: 'SELF_SERVICE' as const,
      band: { code: studentCount > 400 ? 'BAND_401_500'
        : studentCount > 300 ? 'BAND_301_400'
          : studentCount > 200 ? 'BAND_201_300'
            : studentCount > 150 ? 'BAND_151_200'
              : studentCount > 100 ? 'BAND_101_150'
                : studentCount > 50 ? 'BAND_051_100'
                  : studentCount > 25 ? 'BAND_026_050' : 'BAND_001_025' },
    };
    if (!target || target.kind === 'SPECIALIST') {
      if (context.billingPlanCode && !String(context.billingPlanCode).startsWith('BAND_')) return { kind: 'UNSTABLE' };
      return { kind: 'SPECIALIST', reason: 'COUNT_ABOVE_SELF_SERVICE', studentCount };
    }
    return { kind: 'RESOLVED', planCode: target.band.code, currentBand };
  },
}));
vi.mock('@/lib/api/with-tenant-session', () => ({
  withTenantSession: (handler: (_context: typeof tenantContext) => unknown) => {
    if (state.tenantSessionError) throw state.tenantSessionError;
    return handler(tenantContext);
  },
}));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request_1', logApiOperationalEvent: logApiOperationalEventMock }));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: () => '127.0.0.1', rateLimitAsync: async () => ({ ok: true }) }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  assertCanManagePlatformBilling: () => null,
  countActivePlatformBillingStudents: async () => state.activeStudents,
  resolvePlatformBillingEnvironment: () => 'TEST',
  resolvePlatformBillingActor: async () => ({
    canManagePlatformBilling: true,
    conta: { nome: 'Escola A' },
    user: { email: 'admin@example.test' },
  }),
}));

import { POST as checkoutPOST } from '@/app/api/platform-billing/checkout/route';
import { POST as trialPOST } from '@/app/api/platform-billing/trial/route';
import { POST as portalPOST } from '@/app/api/platform-billing/portal/route';

describe('platform billing checkout and trial commercial boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activeStudents = 500;
    state.declaredStudents = null;
    state.planCode = null;
    state.snapshots = [];
    state.billingStatus = 'ACTIVE';
    state.trialEndsAt = null;
    state.firstPaidAt = null;
    state.lastSuccessfulPaymentAt = null;
    state.tenantSessionError = null;
  });

  for (const [label, post, useCase] of [
    ['checkout', checkoutPOST, checkoutMock],
    ['trial', trialPOST, trialMock],
  ] as const) {
    it(`${label} allows 500 students and selects the 401–500 band`, async () => {
      state.activeStudents = 500;
      const response = await post(makeRequest());

      expect(response.status).toBe(200);
      expect(useCase).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_401_500' }), expect.anything());
    });

    it(`${label} returns SPECIALIST_REQUIRED at 501 without invoking the Stripe-backed use case`, async () => {
      state.activeStudents = 501;
      const response = await post(makeRequest());

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: 'SPECIALIST_REQUIRED', activeStudents: 501 });
      expect(useCase).not.toHaveBeenCalled();
    });
  }

  it('uses the persisted onboarding declaration for the first trial price band', async () => {
    state.activeStudents = 0;
    state.declaredStudents = 165;
    const response = await trialPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(trialMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_151_200' }), expect.anything());
  });

  it('keeps completed onboarding above 500 out of the free trial', async () => {
    state.activeStudents = 0;
    state.declaredStudents = 501;

    const response = await trialPOST(makeRequest());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'SPECIALIST_REQUIRED', activeStudents: 501 });
    expect(trialMock).not.toHaveBeenCalled();
  });

  it('keeps the persisted trial band on the explicit post-trial checkout', async () => {
    state.activeStudents = 0;
    state.declaredStudents = 165;
    state.planCode = 'BAND_151_200';
    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_151_200' }), expect.anything());
  });

  it('scopes checkout commercial reads to the authenticated tenant and TEST environment', async () => {
    state.activeStudents = 20;

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(tenantContext.tx.platformBillingAccount.findUnique).toHaveBeenCalledWith({
      where: { uq_platform_billing_account_conta_env: { contaId: 'conta_a', environment: 'TEST' } },
      select: { planCode: true },
    });
    expect(tenantContext.tx.financeProfile.findUnique).toHaveBeenCalledWith({
      where: { contaId: 'conta_a' },
      select: { wizardCompletedAt: true, onboardingStudentCount: true },
    });
    expect(tenantContext.tx.platformBillingMonthlySnapshot.findMany).toHaveBeenCalledWith({
      where: { contaId: 'conta_a', environment: 'TEST' },
      orderBy: { periodStart: 'desc' },
      take: 3,
      select: { periodStart: true, candidateBand: true },
    });
  });

  it('returns safe localized JSON and logs a request id when the tenant callback throws before Stripe', async () => {
    state.tenantSessionError = new Error('database unavailable');

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'PLATFORM_BILLING_UNEXPECTED_ERROR',
      message: 'Não foi possível iniciar a contratação. Tente novamente.',
      requestId: 'request_1',
    });
    expect(logApiOperationalEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.platform_billing.checkout.failed',
      requestId: 'request_1',
      error: state.tenantSessionError,
    }));
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('keeps the confirmed price band when live count exceeds 500 with only one specialist snapshot', async () => {
    state.activeStudents = 701;
    state.planCode = 'BAND_401_500';
    state.snapshots = [{ periodStart: new Date('2030-05-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' }];

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_401_500' }), expect.anything());
  });

  it('blocks a legacy plan from self-service checkout after three consecutive specialist snapshots', async () => {
    state.activeStudents = 701;
    state.planCode = 'STARTER';
    state.snapshots = [
      { periodStart: new Date('2030-05-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2030-04-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2030-03-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
    ];

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'SPECIALIST_REQUIRED' });
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('blocks a retained public band after three consecutive specialist snapshots', async () => {
    state.activeStudents = 701;
    state.planCode = 'BAND_401_500';
    state.snapshots = [
      { periodStart: new Date('2030-05-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2030-04-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2030-03-01T00:00:00.000Z'), candidateBand: 'SPECIALIST' },
    ];

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'SPECIALIST_REQUIRED' });
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('blocks portal access after an unpaid trial expires even with a Stripe customer', async () => {
    state.planCode = 'BAND_001_025';
    state.billingStatus = 'PAUSED';
    state.trialEndsAt = new Date('2025-01-01T00:00:00.000Z');

    const response = await portalPOST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'PLATFORM_BILLING_CHECKOUT_REQUIRED' });
    expect(portalMock).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE', 'PAST_DUE'])('keeps portal available to a previously paid %s account', async (status) => {
    state.planCode = 'BAND_001_025';
    state.billingStatus = status;
    state.trialEndsAt = new Date('2025-01-01T00:00:00.000Z');
    state.firstPaidAt = new Date('2025-01-15T00:00:00.000Z');
    state.lastSuccessfulPaymentAt = state.firstPaidAt;

    const response = await portalPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(portalMock).toHaveBeenCalledOnce();
  });

  it.each(['ACTIVE', 'PAST_DUE'])('allows a legacy %s account with an expired trial and no payment timestamps to use the portal', async (status) => {
    state.planCode = 'STARTER';
    state.billingStatus = status;
    state.trialEndsAt = new Date('2025-01-01T00:00:00.000Z');

    const response = await portalPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(portalMock).toHaveBeenCalledOnce();
  });

  it('returns safe JSON and logs when a raw Stripe SDK error escapes checkout creation', async () => {
    checkoutMock.mockRejectedValueOnce(Object.assign(new Error('No such customer: cus_private'), {
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
    }));

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'PLATFORM_BILLING_PROVIDER_ERROR',
      message: 'Não foi possível iniciar a contratação. Tente novamente.',
    });
    expect(logApiOperationalEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.platform_billing.checkout.stripe_failed',
      requestId: 'request_1',
      error: expect.objectContaining({ type: 'StripeInvalidRequestError' }),
    }));
  });

  it('returns safe JSON and logs when local checkout persistence fails unexpectedly', async () => {
    checkoutMock.mockRejectedValueOnce(new Error('database connection failed: private detail'));

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'PLATFORM_BILLING_UNEXPECTED_ERROR',
      message: 'Não foi possível iniciar a contratação. Tente novamente.',
    });
    expect(logApiOperationalEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.platform_billing.checkout.failed',
      requestId: 'request_1',
      error: expect.any(Error),
    }));
  });

  it('portal returns a stable JSON 500 and safe operational log when audit persistence fails', async () => {
    portalMock.mockRejectedValueOnce(new Error('database connection failed: sensitive details'));

    const response = await portalPOST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'PLATFORM_BILLING_UNEXPECTED_ERROR',
      message: 'Não foi possível abrir a área de pagamento. Tente novamente.',
    });
    expect(logApiOperationalEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.platform_billing.portal.failed',
      requestId: 'request_1',
      error: expect.any(Error),
    }));
  });
});

function makeRequest() {
  return new NextRequest('http://localhost/api/platform-billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'test_route_key' },
    body: '{}',
  });
}
