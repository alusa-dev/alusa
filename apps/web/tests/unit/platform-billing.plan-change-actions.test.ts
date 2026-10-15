import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { gatewayMock } = vi.hoisted(() => ({
  gatewayMock: {
    previewSubscriptionPlanChange: vi.fn(),
    updateSubscriptionPlan: vi.fn(),
    scheduleSubscriptionPlanChange: vi.fn(),
    releaseSubscriptionSchedule: vi.fn(),
    retrieveSubscription: vi.fn(),
  },
}));

vi.mock('@alusa/platform-billing', () => ({
  PLATFORM_PLANS: {
    STARTER: { maxActiveStudents: 60 },
    PREMIUM: { maxActiveStudents: 150 },
    PRO: { maxActiveStudents: 300 },
  },
  PlatformBillingError: class PlatformBillingError extends Error {
    code: string;
    details?: unknown;

    constructor(message: string, code: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  createDefaultPlatformBillingStripeGateway: vi.fn(() => gatewayMock),
  schedulePlatformBillingDowngrade: vi.fn(async (input, deps) => {
    const claimToken = 'test-claim-token';
    const reserved = await deps.store.reservePendingPlan({
      contaId: input.contaId, environment: input.environment, billingAccountId: input.billingAccountId,
      stripeSubscriptionId: input.planChange.stripeSubscriptionId, fromPlanCode: input.planChange.fromPlanCode,
      toPlanCode: input.planChange.toPlanCode, effectiveAt: input.planChange.effectiveAt,
      operationId: input.planChange.id, claimToken, claimAt: new Date(), claimExpiresBefore: new Date(0),
    });
    if (!reserved) throw new Error('reservation lost');
    const schedule = await deps.stripeGateway.scheduleSubscriptionPlanChange({
      subscriptionId: input.planChange.stripeSubscriptionId,
      priceId: input.planChange.stripePriceId,
      effectiveAt: input.planChange.effectiveAt,
      metadata: { contaId: input.contaId, planCode: input.planChange.toPlanCode, billingContext: 'platform', planChangeId: input.planChange.id },
      idempotencyKey: `alusa:${input.environment}:${input.contaId}:plan-change:${input.planChange.id}:stripe-downgrade`,
    });
    await deps.store.persistSchedule({ planChangeId: input.planChange.id, scheduleId: schedule.scheduleId, activeStudents: input.activeStudents, claimToken });
    await deps.store.completePendingPlanClaim({ billingAccountId: input.billingAccountId, operationId: input.planChange.id, claimToken, effectiveAt: schedule.effectiveAt });
    await deps.store.createAuditLog({ action: 'PLATFORM_BILLING_DOWNGRADE_SCHEDULED' });
    return schedule;
  }),
  evaluateStudentCapacity: vi.fn(({ activeStudents, planCode }) => {
    const limits: Record<string, number> = { STARTER: 60, PREMIUM: 150, PRO: 300 };
    const maxActiveStudents = limits[planCode] ?? 0;
    return {
      allowed: activeStudents <= maxActiveStudents,
      activeStudents,
      maxActiveStudents,
    };
  }),
  resolveStripePriceId: vi.fn(({ planCode }) => `price_${planCode.toLowerCase()}`),
}));

vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));

import { applyDuePlatformPlanChanges, requestPlatformPlanChange } from '@/src/server/platform-billing/plan-change-actions';

describe('requestPlatformPlanChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMock.updateSubscriptionPlan.mockResolvedValue({
      id: 'sub_1',
      status: 'trialing',
      priceId: 'price_premium',
      currentPeriodEnd: new Date('2026-07-15T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      pendingUpdateId: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockResolvedValue({
      scheduleId: 'sched_1', effectiveAt: new Date('2026-07-15T00:00:00.000Z'),
    });
  });

  it('rejects oversized idempotency keys before querying plan-change state', async () => {
    const prisma = createPrismaMock();
    await expect(requestPlatformPlanChange({
      prisma: prisma as never,
      contaId: 'conta_1',
      actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM',
      idempotencyKey: 'k'.repeat(129),
    })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_INPUT_INVALID' });
    expect(prisma.platformBillingPlanChange.findUnique).not.toHaveBeenCalled();
  });

  it('downgrade replay re-verifies Stripe schedule and repairs missing local pending state', async () => {
    const effectiveAt = new Date('2026-07-15T00:00:00.000Z');
    const existing = {
      id: 'plan_change_downgrade', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'PRO', toPlanCode: 'PREMIUM', stripeSubscriptionId: 'sub_1',
      stripePriceId: 'price_premium', effectiveAt, metadata: { activeStudents: 42 },
    };
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'ACTIVE',
        planCode: 'PRO', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_pro',
        currentPeriodEnd: effectiveAt, trialEndsAt: null,
      },
      activeStudents: 42,
    });
    prisma.platformBillingPlanChange.findUnique.mockResolvedValue(existing);
    const result = await requestPlatformPlanChange({
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM', idempotencyKey: 'idem_downgrade_replay',
    });
    expect(result).toMatchObject({ planChangeId: existing.id, status: 'PENDING_EFFECTIVE_DATE' });
    expect(gatewayMock.scheduleSubscriptionPlanChange).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_1', priceId: 'price_premium', effectiveAt,
      idempotencyKey: expect.stringContaining('plan-change:plan_change_downgrade'),
    }));
    expect(prisma.platformBillingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'billing_account_1', stripeSubscriptionId: 'sub_1' }),
      data: expect.objectContaining({ pendingPlanCode: 'PREMIUM', pendingChangeType: 'DOWNGRADE' }),
    }));
  });

  it('troca plano durante trial sem preview invoice nem cobranca imediata', async () => {
    const trialEndsAt = new Date('2026-07-15T00:00:00.000Z');
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'TRIALING',
        planCode: 'STARTER',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_starter',
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
      },
      activeStudents: 12,
    });

    const result = await requestPlatformPlanChange({
      prisma: prisma as never,
      contaId: 'conta_1',
      actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM',
      idempotencyKey: 'idem_trial_plan_change',
    });

    expect(result).toMatchObject({
      type: 'UPGRADE',
      status: 'APPLIED',
      message: 'Plano alterado com sucesso.',
    });
    expect(gatewayMock.previewSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(gatewayMock.updateSubscriptionPlan).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_1',
      priceId: 'price_premium',
      prorationBehavior: 'none',
      paymentBehavior: 'allow_incomplete',
    }));
    expect(prisma.platformBillingAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'billing_account_1' },
      data: expect.objectContaining({
        status: 'TRIALING',
        planCode: 'PREMIUM',
        stripePriceId: 'price_premium',
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      }),
    }));
  });

  it('persists the plan-change operation ID with a pending upgrade', async () => {
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'ACTIVE',
        planCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter',
        currentPeriodEnd: new Date('2026-12-01T00:00:00Z'), trialEndsAt: null,
      },
      activeStudents: 12,
    });
    gatewayMock.previewSubscriptionPlanChange.mockResolvedValue({
      amountDue: 10000, amountRemaining: 10000, currency: 'brl', nextPaymentAttempt: null,
    });

    const result = await requestPlatformPlanChange({
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM', idempotencyKey: 'idem_upgrade_operation_id',
    });

    expect(result).toMatchObject({ status: 'PENDING_PAYMENT', type: 'UPGRADE' });
    expect(prisma.platformBillingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'billing_account_1',
        stripeSubscriptionId: 'sub_1', planCode: 'STARTER',
        OR: expect.arrayContaining([expect.objectContaining({ pendingChangeOperationId: null })]),
      }),
      data: expect.objectContaining({
        pendingPlanCode: 'PREMIUM', pendingChangeType: 'UPGRADE',
        pendingChangeOperationId: 'plan_change_1', pendingChangeClaimToken: null,
        pendingChangeClaimedAt: null,
      }),
    }));
    expect(prisma.platformBillingAccount.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(gatewayMock.updateSubscriptionPlan.mock.invocationCallOrder[0]!);
  });

  it('marks the losing same-target upgrade operation superseded when account reservation loses CAS', async () => {
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'ACTIVE',
        planCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter',
        currentPeriodEnd: new Date('2026-12-01T00:00:00Z'), trialEndsAt: null,
      },
      activeStudents: 12,
    });
    const record = {
      id: 'plan_change_loser', type: 'UPGRADE', status: 'PENDING_PAYMENT', fromPlanCode: 'STARTER',
      toPlanCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium',
      effectiveAt: null, metadata: null,
    };
    prisma.platformBillingPlanChange.create.mockResolvedValueOnce(record);
    prisma.platformBillingAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    gatewayMock.previewSubscriptionPlanChange.mockResolvedValue({
      amountDue: 10000, amountRemaining: 10000, currency: 'brl', nextPaymentAttempt: null,
    });

    await expect(requestPlatformPlanChange({
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM', idempotencyKey: 'idem_upgrade_loser',
    })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS' });

    expect(gatewayMock.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(prisma.platformBillingPlanChange.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'plan_change_loser', contaId: 'conta_1', environment: 'TEST', status: 'PENDING_PAYMENT',
      },
      data: {
        status: 'SUPERSEDED',
        lastError: 'Another plan-change operation owns the account reservation.',
      },
    });
  });

  it('recovers a provider-success/local-write failure with the same operation and Stripe key', async () => {
    const account = {
      id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'ACTIVE',
      planCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter',
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'), trialEndsAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeOperationId: null,
      pendingChangeClaimToken: null, pendingChangeClaimedAt: null,
    };
    const prisma = createPrismaMock({ account, activeStudents: 12 });
    const record = {
      id: 'plan_change_1', type: 'UPGRADE', status: 'PENDING_PAYMENT', fromPlanCode: 'STARTER',
      toPlanCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium',
      effectiveAt: null, metadata: null,
    };
    prisma.platformBillingPlanChange.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    prisma.platformBillingPlanChange.create.mockResolvedValueOnce(record);
    prisma.platformBillingPlanChange.update.mockRejectedValueOnce(new Error('local plan-change write failed'));
    prisma.platformBillingAccount.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(account, data);
      return { count: 1 };
    });
    gatewayMock.previewSubscriptionPlanChange.mockResolvedValue({
      amountDue: 10000, amountRemaining: 10000, currency: 'brl', nextPaymentAttempt: null,
    });

    const request = {
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM' as const, idempotencyKey: 'idem_upgrade_recovery',
    };
    await expect(requestPlatformPlanChange(request)).rejects.toThrow('local plan-change write failed');
    expect(account).toMatchObject({ pendingPlanCode: 'PREMIUM', pendingChangeOperationId: 'plan_change_1' });
    await expect(requestPlatformPlanChange(request)).resolves.toMatchObject({ status: 'PENDING_PAYMENT', planChangeId: 'plan_change_1' });

    const providerCalls = gatewayMock.updateSubscriptionPlan.mock.calls;
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]?.[0].idempotencyKey).toBe(providerCalls[1]?.[0].idempotencyKey);
    expect(providerCalls[0]?.[0].metadata.planChangeId).toBe('plan_change_1');
    expect(prisma.platformBillingPlanChange.update).toHaveBeenCalledTimes(2);
    expect(prisma.platformBillingPlanChange.update.mock.calls.every(([call]) => call.data.status !== 'FAILED')).toBe(true);
  });

  it('clears only its reservation after an explicit Stripe invalid-request rejection', async () => {
    const account = {
      id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'ACTIVE',
      planCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter',
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'), trialEndsAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeOperationId: null,
      pendingChangeClaimToken: null, pendingChangeClaimedAt: null,
    };
    const prisma = createPrismaMock({ account, activeStudents: 12 });
    const record = {
      id: 'plan_change_rejected', type: 'UPGRADE', status: 'PENDING_PAYMENT', fromPlanCode: 'STARTER',
      toPlanCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium',
      effectiveAt: null, metadata: null,
    };
    prisma.platformBillingPlanChange.create.mockResolvedValueOnce(record);
    prisma.platformBillingAccount.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(account, data);
      return { count: 1 };
    });
    gatewayMock.previewSubscriptionPlanChange.mockResolvedValue({
      amountDue: 10000, amountRemaining: 10000, currency: 'brl', nextPaymentAttempt: null,
    });
    gatewayMock.updateSubscriptionPlan.mockRejectedValueOnce(Object.assign(new Error('invalid upgrade'), {
      type: 'StripeInvalidRequestError', statusCode: 400,
    }));

    await expect(requestPlatformPlanChange({
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM', idempotencyKey: 'idem_upgrade_rejected',
    })).rejects.toThrow('invalid upgrade');

    expect(prisma.platformBillingAccount.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.platformBillingAccount.updateMany.mock.calls[1]?.[0].where).toMatchObject({
      pendingPlanCode: 'PREMIUM', pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'plan_change_rejected',
    });
    expect(account).toMatchObject({ pendingPlanCode: null, pendingChangeOperationId: null });
    expect(prisma.platformBillingPlanChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('faz replay quando a criação local perde uma corrida pela mesma chave', async () => {
    const trialEndsAt = new Date('2026-07-15T00:00:00.000Z');
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'TRIALING',
        planCode: 'STARTER',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_starter',
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
      },
      activeStudents: 12,
    });
    const concurrent = {
      id: 'plan_change_race',
      type: 'UPGRADE',
      status: 'APPLIED',
      toPlanCode: 'PREMIUM',
      effectiveAt: trialEndsAt,
      metadata: null,
    };
    prisma.platformBillingPlanChange.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrent);
    prisma.platformBillingPlanChange.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.18.0',
        meta: { target: ['contaId', 'environment', 'idempotencyKey'] },
      }),
    );

    const result = await requestPlatformPlanChange({
      prisma: prisma as never,
      contaId: 'conta_1',
      actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM',
      idempotencyKey: 'idem_trial_plan_change_race',
    });

    expect(result).toMatchObject({
      planChangeId: 'plan_change_race',
      type: 'UPGRADE',
      status: 'APPLIED',
    });
    expect(gatewayMock.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(prisma.platformBillingPlanChange.create).toHaveBeenCalledTimes(1);
  });

  it('replays a pending downgrade during trial through the guarded schedule helper', async () => {
    const effectiveAt = new Date('2026-07-15T00:00:00.000Z');
    const prisma = createPrismaMock({
      account: {
        id: 'billing_account_1', contaId: 'conta_1', environment: 'TEST', status: 'TRIALING',
        planCode: 'PRO', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_pro',
        currentPeriodEnd: effectiveAt, trialEndsAt: effectiveAt,
      },
      activeStudents: 42,
    });
    const pendingDowngrade = {
      id: 'plan_change_trial_downgrade', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'PRO', toPlanCode: 'PREMIUM', stripeSubscriptionId: 'sub_1',
      stripePriceId: 'price_premium', effectiveAt, metadata: { activeStudents: 42 },
    };
    prisma.platformBillingPlanChange.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingDowngrade);
    prisma.platformBillingPlanChange.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: '5.18.0',
        meta: { target: ['contaId', 'environment', 'idempotencyKey'] },
      }),
    );

    const result = await requestPlatformPlanChange({
      prisma: prisma as never, contaId: 'conta_1', actorUserId: 'user_1',
      targetPlanCode: 'PREMIUM', idempotencyKey: 'idem_trial_downgrade_replay',
    });

    expect(result).toMatchObject({ planChangeId: pendingDowngrade.id, status: 'PENDING_EFFECTIVE_DATE' });
    expect(gatewayMock.scheduleSubscriptionPlanChange).toHaveBeenCalledTimes(1);
    expect(gatewayMock.updateSubscriptionPlan).not.toHaveBeenCalled();
  });
});

describe('applyDuePlatformPlanChanges tenant binding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defers an effective downgrade while its Stripe schedule claim is active', async () => {
    const change = {
      id: 'change-claimed', contaId: 'conta-a', billingAccountId: 'account-a',
      environment: 'TEST', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      toPlanCode: 'STARTER', effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      billingAccount: {
        id: 'account-a', contaId: 'conta-a', environment: 'TEST', stripeSubscriptionId: 'sub-a',
        planCode: 'PREMIUM', stripePriceId: 'price_premium',
        pendingPlanCode: 'STARTER', pendingChangeType: 'DOWNGRADE', pendingChangeOperationId: 'change-claimed',
        pendingChangeClaimToken: 'active-claim', pendingChangeClaimedAt: new Date(),
      },
    };
    const changeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      platformBillingPlanChange: { findMany: vi.fn(async () => [change]), updateMany: changeUpdateMany },
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(async () => true),
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 0, failed: 0 });
    expect(changeUpdateMany).not.toHaveBeenCalled();
    expect(gatewayMock.scheduleSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(gatewayMock.updateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('recovers an expired downgrade lease with the same operation idempotency key before applying', async () => {
    const effectiveAt = new Date(Date.now() - 60_000);
    const change = {
      id: 'change-expired', contaId: 'conta-a', billingAccountId: 'account-a',
      environment: 'TEST', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER', stripeSubscriptionId: 'sub-a',
      stripePriceId: 'price_starter', effectiveAt, metadata: { stripeScheduleId: 'sched_original' },
      correlationId: 'request-correlation',
      billingAccount: {
        id: 'account-a', contaId: 'conta-a', environment: 'TEST', status: 'ACTIVE',
        planCode: 'PREMIUM', stripeSubscriptionId: 'sub-a', stripePriceId: 'price_premium',
        pendingPlanCode: 'STARTER', pendingChangeType: 'DOWNGRADE',
        pendingChangeOperationId: 'change-expired', pendingChangeClaimToken: 'stale-claim',
        pendingChangeClaimedAt: new Date(Date.now() - 6 * 60_000),
      },
    };
    const accountState = { ...change.billingAccount };
    gatewayMock.retrieveSubscription.mockResolvedValue({
      id: 'sub-a', status: 'active', priceId: 'price_starter', currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: false, trialEndsAt: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockResolvedValue({ scheduleId: 'sched_original', effectiveAt });
    const accountCas = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const claimConditions = where.OR as Array<Record<string, unknown>> | undefined;
      const claimMatches = claimConditions?.some((condition) =>
        condition.pendingChangeClaimToken === null
        || (condition.pendingChangeClaimToken === accountState.pendingChangeClaimToken
          && (condition.pendingChangeClaimedAt as { equals?: Date; lte?: Date } | undefined)?.equals === accountState.pendingChangeClaimedAt
          && accountState.pendingChangeClaimedAt.getTime()
            <= (condition.pendingChangeClaimedAt as { lte: Date }).lte.getTime()),
      ) ?? false;
      if (!claimMatches || where.pendingChangeOperationId !== accountState.pendingChangeOperationId) return { count: 0 };
      Object.assign(accountState, data);
      return { count: 1 };
    });
    const tx = {
      platformBillingAccount: { updateMany: accountCas },
      platformBillingPlanChange: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const transaction = vi.fn(async (callback) => callback(tx as never));
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeCreate = vi.fn();
    const prisma = {
      platformBillingPlanChange: {
        findMany: vi.fn(async () => [change]), updateMany: planChangeUpdateMany, create: planChangeCreate,
      },
      platformBillingAccount: { updateMany: accountUpdateMany },
      $transaction: transaction,
      matricula: { findMany: vi.fn(async () => []) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 1, failed: 0 });
    // Stripe has already applied and detached the schedule; don't replay a past effectiveAt.
    expect(gatewayMock.scheduleSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(planChangeCreate).not.toHaveBeenCalled();
    expect(gatewayMock.retrieveSubscription).toHaveBeenCalledWith('sub-a');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.platformBillingPlanChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'change-expired', contaId: 'conta-a', billingAccountId: 'account-a',
        environment: 'TEST', status: 'PENDING_EFFECTIVE_DATE',
      }),
      data: expect.objectContaining({ status: 'APPLIED', stripePriceId: 'price_starter', appliedAt: expect.any(Date) }),
    }));
    expect(accountCas).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        pendingChangeOperationId: 'change-expired',
        OR: expect.arrayContaining([expect.objectContaining({
          pendingChangeClaimToken: 'stale-claim',
          pendingChangeClaimedAt: expect.objectContaining({
            equals: change.billingAccount.pendingChangeClaimedAt,
            lte: expect.any(Date),
          }),
        })]),
      }),
      data: expect.objectContaining({ pendingChangeClaimToken: null, pendingChangeClaimedAt: null }),
    }));
  });

  it('applies Stripe-confirmed downgrade and raises an issue when capacity grew after scheduling', async () => {
    const effectiveAt = new Date(Date.now() - 60_000);
    const change = buildDueChangeWithExpiredClaim(effectiveAt);
    gatewayMock.retrieveSubscription.mockResolvedValue({
      id: 'sub-a', status: 'active', priceId: 'price_starter', currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: false, trialEndsAt: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockResolvedValue({ scheduleId: 'sched_original', effectiveAt });
    const issueUpsert = vi.fn(async () => ({}));
    const tx = {
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingPlanChange: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      platformBillingPlanChange: { findMany: vi.fn(async () => [change]), updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingIssue: { upsert: issueUpsert },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
      matricula: { findMany: vi.fn(async () => Array.from({ length: 61 }, (_, index) => ({ id: `enrollment-${index}` }))) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 1, failed: 0 });
    expect(gatewayMock.releaseSubscriptionSchedule).not.toHaveBeenCalled();
    expect(issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'DOWNGRADE_CAPACITY_EXCEEDED_AFTER_SCHEDULE' }),
    }));
    expect(tx.platformBillingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ planCode: 'STARTER', pendingChangeOperationId: null }),
    }));
  });

  it('releases an unapplied recovered schedule before failing an over-capacity downgrade', async () => {
    const effectiveAt = new Date(Date.now() - 60_000);
    const change = buildDueChangeWithExpiredClaim(effectiveAt);
    gatewayMock.retrieveSubscription.mockResolvedValue({
      id: 'sub-a', status: 'active', priceId: 'price_premium', currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: false, trialEndsAt: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockResolvedValue({ scheduleId: 'sched_original', effectiveAt });
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { update: vi.fn(async () => ({})), updateMany: planChangeUpdateMany },
    };
    const prisma = {
      platformBillingPlanChange: { findMany: vi.fn(async () => [change]), updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingIssue: { upsert: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
      matricula: { findMany: vi.fn(async () => Array.from({ length: 61 }, (_, index) => ({ id: `enrollment-${index}` }))) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 0, failed: 1 });
    expect(gatewayMock.releaseSubscriptionSchedule).toHaveBeenCalledWith({
      scheduleId: 'sched_original',
      idempotencyKey: 'alusa:TEST:conta-a:plan-change:change-expired:stripe-downgrade-release',
    });
    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pendingChangeOperationId: null, pendingChangeClaimToken: null }),
    }));
    expect(planChangeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'change-expired', status: 'PENDING_EFFECTIVE_DATE' }),
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('keeps an expired downgrade reservation pending and opens an issue after ambiguous schedule recovery', async () => {
    const effectiveAt = new Date(Date.now() - 60_000);
    const change = buildDueChangeWithExpiredClaim(effectiveAt);
    gatewayMock.retrieveSubscription.mockResolvedValue({
      id: 'sub-a', status: 'active', priceId: 'price_premium', currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: false, trialEndsAt: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockRejectedValueOnce(new Error('Stripe request timed out'));
    const issueUpsert = vi.fn(async () => ({}));
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      platformBillingPlanChange: { findMany: vi.fn(async () => [change]), updateMany: planChangeUpdateMany },
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingIssue: { upsert: issueUpsert },
      $transaction: vi.fn(),
      matricula: { findMany: vi.fn(async () => []) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 0, failed: 0 });
    expect(gatewayMock.scheduleSubscriptionPlanChange).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ planChangeId: 'change-expired' }),
      idempotencyKey: 'alusa:TEST:conta-a:plan-change:change-expired:stripe-downgrade',
    }));
    expect(gatewayMock.retrieveSubscription).toHaveBeenCalledWith('sub-a');
    expect(planChangeUpdateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'DOWNGRADE_SCHEDULE_RECOVERY_FAILED', status: 'OPEN' }),
      update: expect.objectContaining({ status: 'OPEN', resolvedAt: null }),
    }));
  });

  it('retains a pending over-capacity downgrade and opens an issue when schedule release is ambiguous', async () => {
    const effectiveAt = new Date(Date.now() - 60_000);
    const change = buildDueChangeWithExpiredClaim(effectiveAt);
    gatewayMock.retrieveSubscription.mockResolvedValue({
      id: 'sub-a', status: 'active', priceId: 'price_premium', currentPeriodEnd: effectiveAt,
      cancelAtPeriodEnd: false, trialEndsAt: null,
    });
    gatewayMock.scheduleSubscriptionPlanChange.mockResolvedValue({ scheduleId: 'sched_original', effectiveAt });
    gatewayMock.releaseSubscriptionSchedule.mockRejectedValueOnce(new Error('Stripe release timed out'));
    const issueUpsert = vi.fn(async () => ({}));
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      platformBillingPlanChange: { findMany: vi.fn(async () => [change]), updateMany: planChangeUpdateMany },
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingIssue: { upsert: issueUpsert },
      $transaction: vi.fn(),
      matricula: { findMany: vi.fn(async () => Array.from({ length: 61 }, (_, index) => ({ id: `student-${index}` }))) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 0, failed: 0 });
    expect(gatewayMock.releaseSubscriptionSchedule).toHaveBeenCalledWith({
      scheduleId: 'sched_original',
      idempotencyKey: 'alusa:TEST:conta-a:plan-change:change-expired:stripe-downgrade-release',
    });
    expect(accountUpdateMany).toHaveBeenCalledTimes(2); // reserve + complete this same operation's claim
    expect(accountUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 'account-a', contaId: 'conta-a', environment: 'TEST' }),
      data: expect.objectContaining({ pendingChangeClaimToken: 'test-claim-token' }),
    }));
    expect(planChangeUpdateMany).not.toHaveBeenCalled();
    expect(issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'DOWNGRADE_RELEASE_RECONCILIATION_REQUIRED', status: 'OPEN' }),
      update: expect.objectContaining({ status: 'OPEN', resolvedAt: null }),
    }));
  });

  it('fails a plan change whose billing account belongs to another Conta before Stripe access', async () => {
    const change = {
      id: 'change-conta-a',
      contaId: 'conta-a',
      billingAccountId: 'account-conta-b',
      environment: 'TEST',
      type: 'DOWNGRADE',
      status: 'PENDING_EFFECTIVE_DATE',
      toPlanCode: 'STARTER',
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      billingAccount: {
        id: 'account-conta-b',
        contaId: 'conta-b',
        environment: 'TEST',
        stripeSubscriptionId: 'sub-conta-b',
      },
    };
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      platformBillingPlanChange: {
        findMany: vi.fn(async () => [change]),
        updateMany: planChangeUpdateMany,
      },
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
    } as never;

    await expect(applyDuePlatformPlanChanges({ prisma })).resolves.toEqual({ checked: 1, submitted: 0, failed: 1 });
    expect(planChangeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'change-conta-a',
        contaId: 'conta-a',
        environment: 'TEST',
      }),
    }));
    expect(gatewayMock.scheduleSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(gatewayMock.updateSubscriptionPlan).not.toHaveBeenCalled();
  });
});

function createPrismaMock(input: {
  account: Record<string, unknown>;
  activeStudents: number;
}) {
  return {
    $transaction: vi.fn(async (callback) => callback({
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingPlanChange: { update: vi.fn(async ({ data }) => ({ id: 'plan_change_1', ...data })) },
    } as never)),
    platformBillingPlanChange: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({
        id: 'plan_change_1',
        ...data,
      })),
      update: vi.fn(async ({ data }) => ({
        id: 'plan_change_1',
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    platformBillingAccount: {
      findUnique: vi.fn(async () => input.account),
      update: vi.fn(async ({ data }) => ({
        ...input.account,
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    platformBillingAuditLog: {
      create: vi.fn(async ({ data }) => ({ id: 'audit_1', ...data })),
      findFirst: vi.fn(async () => null),
    },
    matricula: {
      findMany: vi.fn(async () =>
        Array.from({ length: input.activeStudents }, (_, index) => ({ alunoId: `aluno_${index}` })),
      ),
    },
  };
}

function buildDueChangeWithExpiredClaim(effectiveAt: Date) {
  return {
    id: 'change-expired', contaId: 'conta-a', billingAccountId: 'account-a',
    environment: 'TEST', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
    fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER', stripeSubscriptionId: 'sub-a',
    stripePriceId: 'price_starter', effectiveAt, metadata: { stripeScheduleId: 'sched_original' },
    correlationId: 'request-correlation',
    billingAccount: {
      id: 'account-a', contaId: 'conta-a', environment: 'TEST', status: 'ACTIVE',
      planCode: 'PREMIUM', stripeSubscriptionId: 'sub-a', stripePriceId: 'price_premium',
      pendingPlanCode: 'STARTER', pendingChangeType: 'DOWNGRADE',
      pendingChangeOperationId: 'change-expired', pendingChangeClaimToken: 'stale-claim',
      pendingChangeClaimedAt: new Date(Date.now() - 6 * 60_000),
    },
  };
}
