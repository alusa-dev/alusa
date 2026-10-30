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
    invitation: null as null | { id: string; currentConditionVersion: number; conditionType: 'STANDARD' | 'CUSTOM'; studentCount: number | null; planCode?: string | null; monthlyAmountCents: number | null; customBaseMonthlyAmountCents?: number | null; customIncludedStudentCount?: number | null; customMonthlyOverageAmountCents?: number | null; trialDays?: number; stripePriceId?: string | null; stripeProductId?: string | null },
    acceptedSelections: [] as Array<{ invitationId: string; version: number; contaId: string; acceptedBy: string; selectedStudentCount: number; selectedPlanCode: string | null; selectedMonthlyAmountCents: number | null }>,
    currentUserId: 'admin_a',
    canManagePlatformBilling: true,
  };
  const checkoutMock = vi.fn(async () => ({ checkoutSessionId: 'cs_1', checkoutUrl: 'https://checkout.test', reused: false }));
  const trialMock = vi.fn(async () => ({ billingAccountId: 'account_1', stripeSubscriptionId: 'sub_1', trialEndsAt: new Date('2030-01-15T00:00:00Z'), reused: false }));
  const portalMock = vi.fn(async () => ({ billingAccountId: 'account_1', portalSessionId: 'bps_1', portalUrl: 'https://billing.test' }));
  const logApiOperationalEventMock = vi.fn();
  const tenantContext = {
    contaId: 'conta_a',
    get userId() { return state.currentUserId; },
    tx: {
      $queryRaw: vi.fn(async () => []),
      conta: { findFirst: vi.fn(async () => ({ id: 'conta_a' })) },
      financeProfile: { findUnique: vi.fn(async () => ({
        wizardCompletedAt: new Date('2030-01-01T00:00:00Z'),
        onboardingStudentCount: state.declaredStudents,
        asaasAccount: {
          asaasAccountId: 'asaas_account_a',
          apiKeyEncrypted: 'encrypted_test_key',
          apiKeyStatus: 'CONNECTED',
        },
      })) },
      platformBillingAccount: { findUnique: vi.fn(async () => state.planCode || state.trialEndsAt ? {
        id: 'account_a',
        stripeCustomerId: 'cus_a',
        stripeSubscriptionId: 'sub_a',
        planCode: state.planCode,
        status: state.billingStatus,
        trialEndsAt: state.trialEndsAt,
        firstPaidAt: state.firstPaidAt,
        lastSuccessfulPaymentAt: state.lastSuccessfulPaymentAt,
      } : null) },
      platformSchoolInvitation: { findFirst: vi.fn(async () => state.invitation) },
      platformSchoolInvitationConditionAcceptance: {
        findFirst: vi.fn(async ({ where }: { where: { invitationId: string; version: number; contaId: string; selectedStudentCount?: number } }) => state.acceptedSelections.find((row) => row.invitationId === where.invitationId && row.version === where.version && row.contaId === where.contaId && (where.selectedStudentCount === undefined || row.selectedStudentCount === where.selectedStudentCount)) ?? null),
        createMany: vi.fn(async ({ data }: { data: Array<(typeof state.acceptedSelections)[number]> }) => {
          const row = data[0]!;
          const duplicate = state.acceptedSelections.some((current) => current.invitationId === row.invitationId && current.version === row.version && current.contaId === row.contaId && current.selectedStudentCount === row.selectedStudentCount);
          if (duplicate) return { count: 0 };
          state.acceptedSelections.push(row);
          return { count: 1 };
        }),
      },
      platformSchoolInvitationHistory: { create: vi.fn(async () => ({ id: 'history_1' })) },
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
    const amountCents = ({
      BAND_001_025: 9900,
      BAND_026_050: 17900,
      BAND_051_100: 28900,
      BAND_101_150: 35900,
      BAND_151_200: 41900,
      BAND_201_300: 49900,
      BAND_301_400: 57900,
      BAND_401_500: 64900,
    } as Record<string, number>)[code];
    return { kind: 'SELF_SERVICE', band: { code, amountCents } };
  },
  calculateCustomInvitationMonthlyAmountCents: ({ baseMonthlyAmountCents, includedStudentCount, monthlyPerStudentOverageCents, studentCount }: { baseMonthlyAmountCents: number; includedStudentCount: number; monthlyPerStudentOverageCents: number; studentCount: number }) => baseMonthlyAmountCents + Math.max(0, studentCount - includedStudentCount) * monthlyPerStudentOverageCents,
  resolvePlatformBillingCheckoutPlan: async (
    deps: { loadContext: () => Promise<{
      activeStudents: number;
      billingPlanCode: string | null;
      onboardingPricing: { wizardCompletedAt: Date | null; onboardingStudentCount: number | null } | null;
      recentSnapshots: Array<{ periodStart: Date; candidateBand: string | null }>;
      acceptedInvitation?: { conditionType: string; studentCount: number | null } | null;
      }> },
  ) => {
    const context = await deps.loadContext();
    const declared = context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount
      ? context.onboardingPricing.onboardingStudentCount
      : null;
    if (context.acceptedInvitation?.conditionType === 'CUSTOM') {
      return { kind: 'RESOLVED', planCode: 'CUSTOM', currentBand: null, studentCount: declared ?? context.acceptedInvitation.studentCount ?? 0, stripePriceId: context.acceptedInvitation.stripePriceId };
    }
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
    const studentCount = context.acceptedInvitation && context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount !== null
      ? declared ?? 0
      : context.activeStudents > 0 ? context.activeStudents : declared ?? 0;
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
  resolveTenantSession: async () => ({ ok: true, contaId: tenantContext.contaId, userId: tenantContext.userId }),
  withTenantSession: (handler: (_context: typeof tenantContext) => unknown) => {
    if (state.tenantSessionError) throw state.tenantSessionError;
    return handler(tenantContext);
  },
}));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: async (_contaId: string, handler: (tx: typeof tenantContext.tx) => unknown) => handler(tenantContext.tx),
}));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request_1', logApiOperationalEvent: logApiOperationalEventMock }));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: () => '127.0.0.1', rateLimitAsync: async () => ({ ok: true }) }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  assertCanManagePlatformBilling: (canManage: boolean) => canManage ? null : new Response(JSON.stringify({ error: 'SEM_PERMISSAO' }), { status: 403 }),
  countActivePlatformBillingStudents: async () => state.activeStudents,
  resolvePlatformBillingEnvironment: () => 'TEST',
  resolvePlatformBillingActor: async () => ({
    canManagePlatformBilling: state.canManagePlatformBilling,
    conta: { nome: 'Escola A' },
    user: { email: 'admin@example.test' },
  }),
}));

import { POST as checkoutPOST } from '@/app/api/platform-billing/checkout/route';
import { POST as trialPOST } from '@/app/api/platform-billing/trial/route';
import { POST as portalPOST } from '@/app/api/platform-billing/portal/route';
import { POST as acceptConditionPOST } from '@/app/api/platform-billing/onboarding-condition/acceptance/route';

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
    state.invitation = null;
    state.acceptedSelections = [];
    state.currentUserId = 'admin_a';
    state.canManagePlatformBilling = true;
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

  it('blocks checkout and trial until the latest accepted invitation condition version is accepted', async () => {
    state.activeStudents = 500;
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_1', currentConditionVersion: 2, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    state.acceptedSelections = [{ invitationId: 'invitation_1', version: 1, contaId: 'conta_a', acceptedBy: 'admin_a', selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 }];
    for (const post of [checkoutPOST, trialPOST]) {
      const response = await post(makeRequest());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: 'INVITATION_CONDITION_ACCEPTANCE_REQUIRED', currentVersion: 2 });
    }
    expect(checkoutMock).not.toHaveBeenCalled();
    expect(trialMock).not.toHaveBeenCalled();
  });

  it('does not let Conta B condition acceptance authorize trial or Checkout for Conta A', async () => {
    state.activeStudents = 500;
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_a', currentConditionVersion: 4, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    state.acceptedSelections = [{
      invitationId: 'invitation_a', version: 4, contaId: 'conta_b', acceptedBy: 'admin_b',
      selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900,
    }];

    for (const post of [trialPOST, checkoutPOST]) {
      const response = await post(makeRequest());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: 'INVITATION_CONDITION_ACCEPTANCE_REQUIRED', currentVersion: 4 });
    }

    expect(tenantContext.contaId).toBe('conta_a');
    expect(checkoutMock).not.toHaveBeenCalled();
    expect(trialMock).not.toHaveBeenCalled();
  });

  it('allows trial after the latest invitation condition version is explicitly accepted', async () => {
    state.activeStudents = 500;
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_1', currentConditionVersion: 2, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    state.acceptedSelections = [{ invitationId: 'invitation_1', version: 2, contaId: 'conta_a', acceptedBy: 'admin_a', selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 }];
    const response = await trialPOST(makeRequest());
    expect(response.status).toBe(200);
    expect(trialMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_051_100' }), expect.anything());
    const checkoutResponse = await checkoutPOST(makeRequest());
    expect(checkoutResponse.status).toBe(200);
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'BAND_051_100' }), expect.anything());
  });

  it('persists the recomputed estimate and band once without replacing the first acceptance', async () => {
    state.activeStudents = 500;
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_1', currentConditionVersion: 3, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    const stale = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', { method: 'POST', body: JSON.stringify({ accepted: true, version: 2, selectedStudentCount: 100 }) }));
    expect(stale.status).toBe(409);
    const accepted = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', { method: 'POST', body: JSON.stringify({ accepted: true, version: 3, selectedStudentCount: 100 }) }));
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({ selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 });
    expect(state.acceptedSelections).toHaveLength(1);
    expect(state.acceptedSelections[0]).toMatchObject({ acceptedBy: 'admin_a', selectedStudentCount: 100, selectedPlanCode: 'BAND_051_100', selectedMonthlyAmountCents: 28900 });
    expect(tenantContext.tx.platformSchoolInvitationHistory.create).toHaveBeenCalledTimes(1);

    state.currentUserId = 'finance_b';
    const retry = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', { method: 'POST', body: JSON.stringify({ accepted: true, version: 3, selectedStudentCount: 100 }) }));
    await expect(retry.json()).resolves.toMatchObject({ alreadyAccepted: true });
    expect(state.acceptedSelections[0]?.acceptedBy).toBe('admin_a');
    expect(tenantContext.tx.platformSchoolInvitationHistory.create).toHaveBeenCalledTimes(1);
  });

  it('persists the accepted effective custom amount using the overage contract', async () => {
    state.declaredStudents = 40;
    state.invitation = {
      id: 'invitation_custom', currentConditionVersion: 5, conditionType: 'CUSTOM', studentCount: 40,
      planCode: null, monthlyAmountCents: 23_750, trialDays: 14, stripePriceId: 'price_custom_tiered',
      stripeProductId: 'prod_custom_tiered', customBaseMonthlyAmountCents: 20_000,
      customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250,
    };
    const response = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', {
      method: 'POST', body: JSON.stringify({ accepted: true, version: 5, selectedStudentCount: 40 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ selectedStudentCount: 40, selectedPlanCode: 'CUSTOM', selectedMonthlyAmountCents: 23_750 });
    expect(state.acceptedSelections[0]).toMatchObject({ selectedPlanCode: 'CUSTOM', selectedStudentCount: 40, selectedMonthlyAmountCents: 23_750 });
  });

  it('rejects a custom invitation count that differs from the persisted onboarding estimate without writes', async () => {
    state.declaredStudents = 41;
    state.invitation = {
      id: 'invitation_custom_locked', currentConditionVersion: 5, conditionType: 'CUSTOM', studentCount: 40,
      planCode: null, monthlyAmountCents: 23_750, trialDays: 14, stripePriceId: 'price_custom_tiered',
      stripeProductId: 'prod_custom_tiered', customBaseMonthlyAmountCents: 20_000,
      customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250,
    };

    const response = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', {
      method: 'POST', body: JSON.stringify({ accepted: true, version: 5, selectedStudentCount: 41 }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'CUSTOM_CONDITION_COUNT_LOCKED' });
    expect(tenantContext.tx.platformSchoolInvitationConditionAcceptance.createMany).not.toHaveBeenCalled();
    expect(tenantContext.tx.platformSchoolInvitationHistory.create).not.toHaveBeenCalled();
  });

  it('uses the invitation Price and accepted student quantity for custom trial and Checkout', async () => {
    state.activeStudents = 40;
    state.declaredStudents = 40;
    state.invitation = {
      id: 'invitation_custom', currentConditionVersion: 6, conditionType: 'CUSTOM', studentCount: 40,
      planCode: null, monthlyAmountCents: 23_750, trialDays: 14, stripePriceId: 'price_custom_tiered',
      stripeProductId: 'prod_custom_tiered', customBaseMonthlyAmountCents: 20_000,
      customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 250,
    };
    state.acceptedSelections = [{ invitationId: 'invitation_custom', version: 6, contaId: 'conta_a', acceptedBy: 'admin_a', selectedStudentCount: 40, selectedPlanCode: 'CUSTOM', selectedMonthlyAmountCents: 23_750 }];

    const trial = await trialPOST(makeRequest());
    expect(trial.status).toBe(200);
    expect(trialMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'CUSTOM', stripePriceId: 'price_custom_tiered', invitationId: 'invitation_custom', quantity: 40 }), expect.anything());

    const checkout = await checkoutPOST(makeRequest());
    expect(checkout.status).toBe(200);
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'CUSTOM', stripePriceId: 'price_custom_tiered', invitationId: 'invitation_custom', quantity: 40 }), expect.anything());
  });

  it('allows an accepted custom Price above 500 through trial and Checkout', async () => {
    state.activeStudents = 501;
    state.declaredStudents = 501;
    state.invitation = {
      id: 'invitation_custom_large', currentConditionVersion: 1, conditionType: 'CUSTOM', studentCount: 501,
      monthlyAmountCents: 300_250, trialDays: 14, stripePriceId: 'price_custom_large', stripeProductId: 'prod_custom_large',
      customBaseMonthlyAmountCents: 200_000, customIncludedStudentCount: 100, customMonthlyOverageAmountCents: 250,
    };
    state.acceptedSelections = [{ invitationId: 'invitation_custom_large', version: 1, contaId: 'conta_a', acceptedBy: 'admin_a', selectedStudentCount: 501, selectedPlanCode: 'CUSTOM', selectedMonthlyAmountCents: 300_250 }];

    const trial = await trialPOST(makeRequest());
    expect(trial.status).toBe(200);
    expect(trialMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'CUSTOM', stripePriceId: 'price_custom_large', quantity: 501 }), expect.anything());

    const checkout = await checkoutPOST(makeRequest());
    expect(checkout.status).toBe(200);
    expect(checkoutMock).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'CUSTOM', stripePriceId: 'price_custom_large', invitationId: 'invitation_custom_large', quantity: 501 }), expect.anything());
  });

  it('rejects a member without active billing-admin permission from accepting terms', async () => {
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_1', currentConditionVersion: 3, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    state.canManagePlatformBilling = false;
    const response = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', { method: 'POST', body: JSON.stringify({ accepted: true, version: 3, selectedStudentCount: 100 }) }));
    expect(response.status).toBe(403);
    expect(tenantContext.tx.$queryRaw).not.toHaveBeenCalled();
    expect(tenantContext.tx.platformSchoolInvitationConditionAcceptance.createMany).not.toHaveBeenCalled();
  });

  it('requires the submitted estimate to match the persisted onboarding selection', async () => {
    state.declaredStudents = 100;
    state.invitation = { id: 'invitation_1', currentConditionVersion: 3, conditionType: 'STANDARD', studentCount: 20, planCode: 'BAND_001_025', monthlyAmountCents: null };
    const response = await acceptConditionPOST(new Request('https://alusa.test/api/platform-billing/onboarding-condition/acceptance', { method: 'POST', body: JSON.stringify({ accepted: true, version: 3, selectedStudentCount: 120 }) }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'ONBOARDING_ESTIMATE_MISMATCH' });
    expect(tenantContext.tx.platformSchoolInvitationConditionAcceptance.createMany).not.toHaveBeenCalled();
  });

  it('scopes checkout commercial reads to the authenticated tenant and TEST environment', async () => {
    state.activeStudents = 20;

    const response = await checkoutPOST(makeRequest());

    expect(response.status).toBe(200);
    expect(tenantContext.tx.platformBillingAccount.findUnique).toHaveBeenCalledWith({
      where: { uq_platform_billing_account_conta_env: { contaId: 'conta_a', environment: 'TEST' } },
      select: { planCode: true, status: true, accessStatus: true },
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
