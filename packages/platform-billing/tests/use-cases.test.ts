import { describe, expect, it, vi } from 'vitest';
import {
  PlatformBillingError,
  createPrismaPlatformBillingStore,
  createPlatformBillingCheckoutSession,
  createPlatformBillingPortalSession,
  createPlatformBillingTrialWithoutPaymentMethod,
  schedulePlatformBillingDowngrade,
} from '../src';
import type {
  PlatformBillingAccountRecord,
  PlatformBillingAuditLogInput,
  PlatformBillingCheckoutSessionRecord,
  PlatformBillingInvoiceRecord,
  PlatformBillingStore,
  PlatformBillingStripeGateway,
  PlatformBillingWebhookEventRecord,
} from '../src';

const envSource = {
  STRIPE_ENVIRONMENT: 'TEST',
  STRIPE_SECRET_KEY: 'sk_test_foundation',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
};

describe('@alusa/platform-billing use cases', () => {
  it('fences a delayed webhook account write with the provider event snapshot CAS', async () => {
    const oldProviderAt = new Date('2026-10-12T00:00:10.000Z');
    const newerProviderAt = new Date('2026-10-12T00:00:30.000Z');
    const live: Record<string, unknown> = {
      id: 'pba_cas', contaId: 'conta_cas', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_cas', stripeSubscriptionId: 'sub_cas', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, gracePeriodEndsAt: null,
      restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      trialWillEndNotifiedAt: null, pendingPlanCode: null, pendingChangeType: null,
      pendingChangeEffectiveAt: null, pendingChangeOperationId: null, pendingChangeClaimToken: null,
      trialSubscriptionClaimKey: null, accessStateVersion: 0,
      lastProviderEventCreatedAt: oldProviderAt, lastStripeEventId: 'evt_snapshot',
    };
    const accountUpdateMany = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      // Model a newer webhook committing after the stale worker read its snapshot.
      live.status = 'CANCELED';
      live.accessStatus = 'RESTRICTED';
      live.lastProviderEventCreatedAt = newerProviderAt;
      live.lastStripeEventId = 'evt_newer';
      const matches = Object.entries(where).every(([key, value]) => live[key] === value);
      if (!matches) return { count: 0 };
      Object.assign(live, data);
      return { count: 1 };
    });
    const tx = {
      platformBillingAccount: {
        findUniqueOrThrow: vi.fn(async () => ({ ...live, status: 'ACTIVE', accessStatus: 'ACTIVE', lastProviderEventCreatedAt: oldProviderAt, lastStripeEventId: 'evt_snapshot' })),
        updateMany: accountUpdateMany,
      },
      platformBillingPlanChange: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const db = { $transaction: vi.fn(async (callback: (_transaction: unknown) => unknown) => callback(tx)) };
    const store = createPrismaPlatformBillingStore(db as never);

    await expect(store.updateAccountFromStripeSubscription({
      accountId: 'pba_cas',
      expectedAccountSnapshot: {
        contaId: 'conta_cas', environment: 'TEST', stripeSubscriptionId: 'sub_cas',
        pendingChangeOperationId: null, pendingChangeClaimToken: null,
        lastProviderEventCreatedAt: oldProviderAt, lastStripeEventId: 'evt_snapshot',
      },
      status: 'ACTIVE', planCode: 'STARTER', stripeSubscriptionId: 'sub_cas', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      lastProviderEventCreatedAt: new Date('2026-10-12T00:00:20.000Z'), lastStripeEventId: 'evt_delayed',
    })).rejects.toThrow('Stripe account snapshot changed before subscription state could be applied.');

    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        lastProviderEventCreatedAt: oldProviderAt,
        lastStripeEventId: 'evt_snapshot',
      }),
    }));
    expect(live).toMatchObject({ status: 'CANCELED', accessStatus: 'RESTRICTED', lastStripeEventId: 'evt_newer' });
  });

  it('simulated PrismaStore contention lets only one distinct checkout key reach Stripe', async () => {
    const account: Record<string, unknown> = {
      id: 'pba_prisma', contaId: 'conta_prisma', environment: 'TEST', status: 'NOT_STARTED',
      planCode: null, stripeCustomerId: 'cus_prisma', stripeSubscriptionId: null, stripePriceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, trialWillEndNotifiedAt: null,
      accessStatus: 'PENDING', gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null,
      lastPaymentFailedAt: null, firstPaidAt: null, lastSuccessfulPaymentAt: null,
      paymentMethodStatus: 'UNKNOWN', paymentMethodType: null, paymentMethodBrand: null,
      paymentMethodLast4: null, paymentMethodExpMonth: null, paymentMethodExpYear: null,
      restrictionReason: null, gracePeriodStartedAt: null, accessStateVersion: 0,
      lastProviderEventCreatedAt: null, lastReconciledAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
      checkoutClaimKey: null, checkoutClaimPhase: null, checkoutClaimedAt: null, checkoutRequestExpiresAt: null,
    };
    const db = {
      platformBillingAccount: {
        findUnique: vi.fn(async () => account),
        findUniqueOrThrow: vi.fn(async () => account),
        updateMany: vi.fn(async ({ where, data }) => {
          if (where.checkoutClaimPhase === 'CLAIMED') {
            if (account.checkoutClaimKey !== where.checkoutClaimKey || account.checkoutClaimPhase !== 'CLAIMED') return { count: 0 };
          } else if (account.checkoutClaimKey !== null) {
            return { count: 0 };
          }
          Object.assign(account, data);
          return { count: 1 };
        }),
      },
      platformBillingCheckoutSession: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }) => ({ id: 'pbcs_prisma', ...create, status: 'CREATED' })),
      },
      platformBillingAuditLog: {
        create: vi.fn(async () => ({ id: 'audit_prisma' })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = createPrismaPlatformBillingStore(db as never);
    const stripeGateway = createStripeGatewayMock();
    const input = buildCheckoutInput();
    const results = await Promise.allSettled([
      createPlatformBillingCheckoutSession({ ...input, idempotencyKey: 'prisma-key-a' }, { store, stripeGateway }),
      createPlatformBillingCheckoutSession({ ...input, idempotencyKey: 'prisma-key-b', planCode: 'PREMIUM' }, { store, stripeGateway }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(account.checkoutClaimPhase).toBe('REQUESTING');
  });

  it('persists webhook retry time in the same worker-fenced failure update', async () => {
    const nextAttemptAt = new Date('2026-10-13T05:00:00.000Z');
    const webhookRecord = {
      id: 'event-a', environment: 'TEST', eventId: 'evt-a', eventType: 'invoice.payment_failed',
      contaId: 'conta-a', status: 'FAILED', attempts: 2, lastError: 'temporary', lastErrorCode: 'TEMPORARY',
      nextAttemptAt, lockedAt: null, lastAttemptAt: new Date(), processingTimeoutAt: null,
      processedAt: null, exhaustedAt: null, workerId: null, correlationId: 'corr-a',
    };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn();
    const db = {
      platformBillingWebhookEvent: {
        updateMany,
        findUniqueOrThrow: vi.fn(async () => webhookRecord),
      },
      $executeRaw: executeRaw,
    };
    const store = createPrismaPlatformBillingStore(db as never);

    const result = await store.markWebhookEventFailed({
      id: 'event-a', contaId: 'conta-a', workerId: 'worker-a',
      error: 'temporary', errorCode: 'TEMPORARY', nextAttemptAt,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'event-a', workerId: 'worker-a', status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'FAILED', workerId: null, nextAttemptAt }),
    }));
    expect(executeRaw).not.toHaveBeenCalled();
    expect(result.nextAttemptAt).toEqual(nextAttemptAt);
  });

  it('does not write retry timing after the worker lease was lost', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const executeRaw = vi.fn();
    const db = {
      platformBillingWebhookEvent: { updateMany },
      $executeRaw: executeRaw,
    };
    const store = createPrismaPlatformBillingStore(db as never);

    await expect(store.markWebhookEventFailed({
      id: 'event-a', contaId: 'conta-a', workerId: 'stale-worker',
      error: 'temporary', nextAttemptAt: new Date('2026-10-13T05:00:00.000Z'),
    })).rejects.toThrow('Stripe webhook lease was lost before failure finalization.');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'event-a', workerId: 'stale-worker', status: 'PROCESSING' },
    }));
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('schedules and repairs downgrade state through the injected use-case boundary', async () => {
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn(async () => ({ scheduleId: 'sub_sched_1', effectiveAt: new Date('2026-12-01T00:00:00Z') }));
    const store = {
      reservePendingPlan: vi.fn(async () => true),
      releasePendingPlanClaim: vi.fn(async () => undefined),
      completePendingPlanClaim: vi.fn(async () => true),
      persistSchedule: vi.fn(async () => true),
      createAuditLog: vi.fn(async () => undefined),
    };
    const result = await schedulePlatformBillingDowngrade({
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST',
      idempotencyKey: 'downgrade-1',
      planChange: {
        id: 'pbc_1', fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER',
        stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
        effectiveAt: new Date('2026-12-01T00:00:00Z'),
      },
      account: { planCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 12,
    }, { store, stripeGateway });

    expect(result.scheduleId).toBe('sub_sched_1');
    expect(stripeGateway.scheduleSubscriptionPlanChange).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'alusa:TEST:conta_1:plan-change:pbc_1:stripe-downgrade',
      metadata: expect.objectContaining({ contaId: 'conta_1', planChangeId: 'pbc_1' }),
    }));
    expect(store.reservePendingPlan).toHaveBeenCalledWith(expect.objectContaining({
      billingAccountId: 'pba_1', fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER', operationId: 'pbc_1',
    }));
    expect(store.reservePendingPlan.mock.invocationCallOrder[0]).toBeLessThan(stripeGateway.scheduleSubscriptionPlanChange.mock.invocationCallOrder[0]!);
    expect(store.persistSchedule).toHaveBeenCalledWith(expect.objectContaining({ planChangeId: 'pbc_1', scheduleId: 'sub_sched_1', activeStudents: 12, claimToken: expect.any(String) }));
    expect(store.completePendingPlanClaim).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'pbc_1', effectiveAt: expect.any(Date) }));
    expect(store.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLATFORM_BILLING_DOWNGRADE_SCHEDULED' }));
  });

  it('reclaims an expired owner lease and retries the same Stripe key after final persistence failure', async () => {
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn(async () => ({ scheduleId: 'sub_sched_recover', effectiveAt: new Date('2026-12-01T00:00:00Z') }));
    let now = new Date('2026-10-01T00:00:00Z');
    let claim: { operationId: string; claimToken: string; claimedAt: Date } | null = null;
    const persistedTokens: string[] = [];
    const store = {
      reservePendingPlan: vi.fn(async (input) => {
        if (claim && claim.claimedAt >= input.claimExpiresBefore) return false;
        claim = { operationId: input.operationId, claimToken: input.claimToken, claimedAt: input.claimAt };
        persistedTokens.push(input.claimToken);
        return true;
      }),
      releasePendingPlanClaim: vi.fn(async (input) => {
        if (claim?.operationId === input.operationId && claim.claimToken === input.claimToken) claim = null;
      }),
      completePendingPlanClaim: vi.fn(async (input) => {
        if (claim?.operationId !== input.operationId || claim.claimToken !== input.claimToken) return false;
        claim = null;
        return true;
      }),
      persistSchedule: vi.fn().mockRejectedValueOnce(new Error('local plan-change write failed')).mockResolvedValueOnce(true),
      createAuditLog: vi.fn(async () => undefined),
    };
    const input = {
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST' as const,
      idempotencyKey: 'downgrade-recovery',
      planChange: {
        id: 'pbc_recover', fromPlanCode: 'PREMIUM' as const, toPlanCode: 'STARTER' as const,
        stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', effectiveAt: new Date('2026-12-01T00:00:00Z'),
      },
      account: { planCode: 'PREMIUM' as const, stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 10,
    };
    const deps = { store, stripeGateway, now: () => now };

    await expect(schedulePlatformBillingDowngrade(input, deps)).rejects.toThrow('local plan-change write failed');
    expect(claim).toMatchObject({ operationId: 'pbc_recover' });
    now = new Date(now.getTime() + 6 * 60_000);
    const retryInput = {
      ...input,
      account: { ...input.account, pendingPlanCode: 'STARTER' as const, pendingChangeOperationId: 'pbc_recover' },
    };
    await expect(schedulePlatformBillingDowngrade(retryInput, deps)).resolves.toMatchObject({ scheduleId: 'sub_sched_recover' });
    expect(stripeGateway.scheduleSubscriptionPlanChange).toHaveBeenCalledTimes(2);
    expect(stripeGateway.scheduleSubscriptionPlanChange.mock.calls[0]?.[0].idempotencyKey)
      .toBe(stripeGateway.scheduleSubscriptionPlanChange.mock.calls[1]?.[0].idempotencyKey);
    expect(store.persistSchedule).toHaveBeenCalledTimes(2);
    expect(persistedTokens).toHaveLength(2);
    expect(persistedTokens[0]).not.toBe(persistedTokens[1]);
    expect(store.releasePendingPlanClaim).not.toHaveBeenCalled();
  });

  it('reclaims an expired lease for the same plan change with one stable provider key and fences stale completion', async () => {
    const stripeGateway = createStripeGatewayMock();
    let resolveFirst!: (_value: { scheduleId: string; effectiveAt: Date }) => void;
    let now = new Date('2026-10-01T00:00:00Z');
    let owner: { operationId: string; claimToken: string; claimedAt: Date } | null = null;
    let calls = 0;
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return { scheduleId: 'sub_sched_same', effectiveAt: new Date('2026-12-01T00:00:00Z') };
    });
    const store = {
      reservePendingPlan: vi.fn(async (claim) => {
        if (owner && owner.claimedAt >= claim.claimExpiresBefore) return false;
        owner = { operationId: claim.operationId, claimToken: claim.claimToken, claimedAt: claim.claimAt };
        return true;
      }),
      releasePendingPlanClaim: vi.fn(async (claim) => {
        if (owner?.claimToken === claim.claimToken) owner = null;
      }),
      persistSchedule: vi.fn(async ({ claimToken }) => owner?.claimToken === claimToken),
      completePendingPlanClaim: vi.fn(async ({ claimToken }) => owner?.claimToken === claimToken),
      createAuditLog: vi.fn(async () => undefined),
    };
    const input = {
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST' as const,
      idempotencyKey: 'initial-request-key',
      planChange: { id: 'pbc_stable', fromPlanCode: 'PREMIUM' as const, toPlanCode: 'STARTER' as const, stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', effectiveAt: new Date('2026-12-01T00:00:00Z') },
      account: { planCode: 'PREMIUM' as const, stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 4,
    };
    const deps = { store, stripeGateway, now: () => now };
    const first = schedulePlatformBillingDowngrade(input, deps);
    while (!resolveFirst) await Promise.resolve();
    now = new Date(now.getTime() + 6 * 60_000);
    const retry = await schedulePlatformBillingDowngrade({
      ...input,
      idempotencyKey: 'different-caller-retry-key',
      account: { ...input.account, pendingPlanCode: 'STARTER', pendingChangeOperationId: 'pbc_stable' },
    }, deps);
    expect(retry.scheduleId).toBe('sub_sched_same');
    resolveFirst({ scheduleId: 'sub_sched_same', effectiveAt: retry.effectiveAt });
    await expect(first).rejects.toMatchObject({ code: 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS' });
    const stripeCalls = stripeGateway.scheduleSubscriptionPlanChange.mock.calls;
    expect(stripeCalls).toHaveLength(2);
    expect(stripeCalls[0]?.[0].idempotencyKey).toBe(stripeCalls[1]?.[0].idempotencyKey);
    expect(store.completePendingPlanClaim).toHaveBeenCalledTimes(1);
  });

  it('does not call Stripe when the conditional downgrade reservation loses a race', async () => {
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn(async () => ({ scheduleId: 'unused', effectiveAt: new Date() }));
    const store = {
      reservePendingPlan: vi.fn(async () => false),
      releasePendingPlanClaim: vi.fn(async () => undefined),
      completePendingPlanClaim: vi.fn(async () => true),
      persistSchedule: vi.fn(async () => true),
      createAuditLog: vi.fn(async () => undefined),
    };
    await expect(schedulePlatformBillingDowngrade({
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST', idempotencyKey: 'racing-downgrade',
      planChange: { id: 'pbc_race', fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', effectiveAt: new Date('2026-12-01T00:00:00Z') },
      account: { planCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 4,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS' });
    expect(stripeGateway.scheduleSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(store.releasePendingPlanClaim).not.toHaveBeenCalled();
  });

  it('retains its claim after an ambiguous Stripe timeout and blocks another operation', async () => {
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn().mockRejectedValue(new Error('Stripe unavailable'));
    const store = {
      reservePendingPlan: vi.fn(async () => true),
      releasePendingPlanClaim: vi.fn(async () => undefined),
      completePendingPlanClaim: vi.fn(async () => true),
      persistSchedule: vi.fn(async () => undefined),
      createAuditLog: vi.fn(async () => undefined),
    };
    const input = {
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST', idempotencyKey: 'failed-downgrade',
      planChange: { id: 'pbc_failed', fromPlanCode: 'PREMIUM', toPlanCode: 'STARTER', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', effectiveAt: new Date('2026-12-01T00:00:00Z') },
      account: { planCode: 'PREMIUM', stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 4,
    };
    await expect(schedulePlatformBillingDowngrade(input, { store, stripeGateway })).rejects.toThrow('Stripe unavailable');
    expect(store.releasePendingPlanClaim).not.toHaveBeenCalled();
    expect(store.persistSchedule).not.toHaveBeenCalled();
    store.reservePendingPlan.mockResolvedValueOnce(false);
    await expect(schedulePlatformBillingDowngrade({
      ...input,
      planChange: { ...input.planChange, id: 'pbc_other' },
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS' });
    expect(stripeGateway.scheduleSubscriptionPlanChange).toHaveBeenCalledTimes(1);
  });

  it('retains the downgrade claim when a schedule update returns definitive 400 after schedule creation', async () => {
    const stripeGateway = createStripeGatewayMock();
    const stripeUpdate400 = Object.assign(new Error('Stripe schedule update rejected'), {
      type: 'StripeScheduleUpdateRecoveryError',
      code: 'STRIPE_SCHEDULE_UPDATE_RECOVERY_REQUIRED',
      cause: Object.assign(new Error('invalid update'), { type: 'StripeInvalidRequestError', statusCode: 400 }),
    });
    stripeGateway.scheduleSubscriptionPlanChange = vi.fn()
      .mockRejectedValueOnce(stripeUpdate400)
      .mockResolvedValueOnce({ scheduleId: 'sub_sched_owned', effectiveAt: new Date('2026-12-01T00:00:00Z') });
    const store = {
      reservePendingPlan: vi.fn(async () => true),
      releasePendingPlanClaim: vi.fn(async () => undefined),
      persistSchedule: vi.fn(async () => true),
      completePendingPlanClaim: vi.fn(async () => true),
      createAuditLog: vi.fn(async () => undefined),
    };
    const input = {
      contaId: 'conta_1', billingAccountId: 'pba_1', actorUserId: 'user_1', environment: 'TEST' as const,
      idempotencyKey: 'schedule-update-400',
      planChange: {
        id: 'pbc_update_400', fromPlanCode: 'PREMIUM' as const, toPlanCode: 'STARTER' as const,
        stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', effectiveAt: new Date('2026-12-01T00:00:00Z'),
      },
      account: { planCode: 'PREMIUM' as const, stripeSubscriptionId: 'sub_1', pendingPlanCode: null, pendingChangeOperationId: null },
      activeStudents: 4,
    };
    const deps = { store, stripeGateway };

    await expect(schedulePlatformBillingDowngrade(input, deps)).rejects.toMatchObject({
      code: 'STRIPE_SCHEDULE_UPDATE_RECOVERY_REQUIRED',
    });
    expect(store.releasePendingPlanClaim).not.toHaveBeenCalled();
    expect(store.persistSchedule).not.toHaveBeenCalled();

    await expect(schedulePlatformBillingDowngrade({
      ...input,
      account: { ...input.account, pendingPlanCode: 'STARTER' as const, pendingChangeOperationId: 'pbc_update_400' },
    }, deps)).resolves.toMatchObject({ scheduleId: 'sub_sched_owned' });
    expect(stripeGateway.scheduleSubscriptionPlanChange).toHaveBeenCalledTimes(2);
    expect(stripeGateway.scheduleSubscriptionPlanChange.mock.calls[0]?.[0].idempotencyKey)
      .toBe(stripeGateway.scheduleSubscriptionPlanChange.mock.calls[1]?.[0].idempotencyKey);
    expect(store.releasePendingPlanClaim).not.toHaveBeenCalled();
  });

  it('cria customer, checkout de assinatura e registro local auditável', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingCheckoutSession(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        billingEmail: 'financeiro@escola.test',
        planCode: 'STARTER',
        successUrl: 'https://app.alusa.test/billing/success',
        cancelUrl: 'https://app.alusa.test/billing/cancel',
        actorUserId: 'user_1',
        idempotencyKey: 'idem_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(false);
    expect(result.checkoutSessionId).toBe('cs_test_1');
    expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        priceId: 'price_starter_test',
        trialDays: 14,
        idempotencyKey: 'alusa:TEST:conta_1:checkout:idem_1',
      }),
    );
    expect(store.auditLogs).toHaveLength(1);
    expect(store.accounts[0]?.status).toBe('CHECKOUT_PENDING');
    expect(store.accounts[0]?.planCode).toBeNull();
    expect(store.accounts[0]?.pendingPlanCode).toBe('STARTER');
  });

  it('nao reaplica trial quando conta ja teve assinatura Stripe', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'CANCELED',
        planCode: 'STARTER',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_old_1',
        stripePriceId: 'price_starter_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
        trialWillEndNotifiedAt: null,
        accessStatus: 'CANCELED',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        trialDays: null,
        metadata: expect.objectContaining({ flow: 'reactivation' }),
      }),
    );
    expect(store.accounts[0]?.pendingChangeType).toBe('REACTIVATE');
    expect(store.accounts[0]?.status).toBe('CANCELED');
    expect(store.accounts[0]?.accessStatus).toBe('CANCELED');
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_REACTIVATION_CHECKOUT_SESSION_CREATED');
  });

  it('reusa sessão local quando idempotency key já existe', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const reused = await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(reused.reused).toBe(true);
    expect(reused.checkoutSessionId).toBe('cs_test_1');
    expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('retoma após sucesso Stripe sem persistência local usando a mesma chave idempotente', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const persist = store.createCheckoutSession.bind(store);
    let crashOnce = true;
    store.createCheckoutSession = async (input) => {
      if (crashOnce) { crashOnce = false; throw new Error('simulated local persistence crash'); }
      return persist(input);
    };
    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toThrow('simulated local persistence crash');
    const retried = await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    expect(retried.checkoutSessionId).toBe('cs_test_1');
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(2);
    expect(stripeGateway.createCheckoutSession.mock.calls.map(([call]) => call.idempotencyKey))
      .toEqual(['alusa:TEST:conta_1:checkout:idem_1', 'alusa:TEST:conta_1:checkout:idem_1']);
  });

  it('bloqueia chave diferente enquanto claim vivo e falha fechado após expiração do request Stripe', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const persist = store.createCheckoutSession.bind(store);
    store.createCheckoutSession = async () => { throw new Error('local persistence unavailable'); };
    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toThrow('local persistence unavailable');
    await expect(createPlatformBillingCheckoutSession(
      { ...buildCheckoutInput(), idempotencyKey: 'different-key' }, { store, stripeGateway },
    )).rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_IN_PROGRESS' });
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);

    store.createCheckoutSession = persist;
    store.markCheckoutRequestStarted = async () => {
      throw new PlatformBillingError('Reconcile Stripe before retrying.', 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED');
    };
    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('rejeita a mesma chave de checkout quando o plano muda', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    await expect(
      createPlatformBillingCheckoutSession(
        { ...buildCheckoutInput(), planCode: 'PREMIUM' },
        { store, stripeGateway },
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT' });

    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('bloqueia novo Checkout quando a conta já tem uma assinatura ativa', async () => {
    const store = createMemoryStore([{
      id: 'pba_active',
      contaId: 'conta_1',
      environment: 'TEST',
      status: 'ACTIVE',
      planCode: 'STARTER',
      stripeCustomerId: 'cus_test_1',
      stripeSubscriptionId: 'sub_active',
      stripePriceId: 'price_starter_test',
      currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialWillEndNotifiedAt: null,
      accessStatus: 'ACTIVE',
      gracePeriodEndsAt: null,
      restrictedAt: null,
      canceledAt: null,
      lastPaymentFailedAt: null,
      lastReconciledAt: null,
      pendingPlanCode: null,
      pendingChangeType: null,
      pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' });
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('cria trial sem forma de pagamento e persiste assinatura local', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingTrialWithoutPaymentMethod(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        billingEmail: 'financeiro@escola.test',
        planCode: 'PREMIUM',
        actorUserId: 'user_1',
        idempotencyKey: 'idem_trial_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(false);
    expect(result.stripeSubscriptionId).toBe('sub_test_trial_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        priceId: 'price_premium_test',
        trialDays: 14,
        idempotencyKey: 'alusa:TEST:conta_1:trial-subscription:idem_trial_1',
      }),
    );
    expect(stripeGateway.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'alusa:TEST:conta_1:customer:platform-account',
    }));
    expect(store.accounts[0]).toMatchObject({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      planCode: 'PREMIUM',
      stripeSubscriptionId: 'sub_test_trial_1',
      stripePriceId: 'price_premium_test',
    });
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_TRIAL_WITHOUT_PAYMENT_METHOD_CREATED');
  });

  it('keeps ambiguous trial creation fenced for same-key recovery and rejects a distinct key', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.createTrialSubscriptionWithoutPaymentMethod = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset after request'))
      .mockResolvedValueOnce({
        id: 'sub_test_trial_1', customerId: 'cus_test_1', status: 'trialing', priceId: 'price_premium_test',
        currentPeriodEnd: new Date('2026-07-15T00:00:00.000Z'), cancelAtPeriodEnd: false,
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'), pendingUpdateId: null,
      });
    const request = (idempotencyKey: string) => createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'PREMIUM', idempotencyKey, envSource,
    }, { store, stripeGateway });

    await expect(request('idem_trial_ambiguous')).rejects.toThrow('connection reset after request');
    expect(store.accounts[0]?.trialSubscriptionClaimPhase).toBe('REQUESTING');
    await expect(request('idem_trial_distinct')).rejects.toMatchObject({ code: 'PLATFORM_BILLING_RECONCILIATION_FAILED' });
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledTimes(1);

    const recovered = await request('idem_trial_ambiguous');
    expect(recovered.stripeSubscriptionId).toBe('sub_test_trial_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledTimes(2);
    const keys = vi.mocked(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).mock.calls.map(([args]) => args.idempotencyKey);
    expect(keys).toEqual([
      'alusa:TEST:conta_1:trial-subscription:idem_trial_ambiguous',
      'alusa:TEST:conta_1:trial-subscription:idem_trial_ambiguous',
    ]);
  });

  it('releases a trial claim after a definitive Stripe rejection', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.createTrialSubscriptionWithoutPaymentMethod = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid Stripe request'), {
        type: 'StripeInvalidRequestError', statusCode: 400,
      }));
    const request = (idempotencyKey: string) => createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'PREMIUM', idempotencyKey, envSource,
    }, { store, stripeGateway });

    await expect(request('idem_trial_rejected')).rejects.toThrow('invalid Stripe request');
    expect(store.accounts[0]?.trialSubscriptionClaimKey).toBeNull();
    expect(store.accounts[0]?.trialSubscriptionClaimPhase).toBeNull();
    stripeGateway.createTrialSubscriptionWithoutPaymentMethod = createStripeGatewayMock().createTrialSubscriptionWithoutPaymentMethod;
    await expect(request('idem_trial_after_rejection')).resolves.toMatchObject({ reused: false });
  });

  it('does not overwrite a subscription already applied by a webhook after the Stripe call', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    store.updateAccountFromStripeSubscription = async () => {
      const account = store.accounts[0];
      if (!account) throw new Error('account not found');
      account.status = 'TRIALING';
      account.accessStatus = 'ACTIVE';
      account.planCode = 'PREMIUM';
      account.stripeSubscriptionId = 'sub_test_trial_1';
      account.stripePriceId = 'price_premium_test';
      account.trialEndsAt = new Date('2026-07-15T00:00:00.000Z');
      account.trialSubscriptionClaimKey = null;
      account.trialSubscriptionClaimPhase = null;
      throw new Error('Stripe account snapshot changed before subscription state could be applied.');
    };

    const result = await createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'PREMIUM', idempotencyKey: 'idem_trial_webhook_race', envSource,
    }, { store, stripeGateway });

    expect(result).toMatchObject({ reused: true, stripeSubscriptionId: 'sub_test_trial_1' });
    expect(store.accounts[0]?.stripeSubscriptionId).toBe('sub_test_trial_1');
    expect(store.auditLogs).toHaveLength(0);
  });

  it('nao duplica trial sem cartao quando assinatura ja existe', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'TRIALING',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_existing_1',
        stripePriceId: 'price_premium_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
        trialWillEndNotifiedAt: null,
        accessStatus: 'ACTIVE',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingTrialWithoutPaymentMethod(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        planCode: 'PREMIUM',
        idempotencyKey: 'idem_trial_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(true);
    expect(result.stripeSubscriptionId).toBe('sub_existing_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).not.toHaveBeenCalled();
  });

  it('falha com Price ausente sem chamar Stripe', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await expect(
      createPlatformBillingCheckoutSession(
        {
          ...buildCheckoutInput(),
          envSource: {
            STRIPE_ENVIRONMENT: 'TEST',
            STRIPE_SECRET_KEY: 'sk_test_foundation',
          },
        },
        { store, stripeGateway },
      ),
    ).rejects.toThrow(PlatformBillingError);
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
  });

  it('rejects idempotency keys over 128 characters before any Stripe request', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const oversizedKey = 'k'.repeat(129);

    await expect(createPlatformBillingCheckoutSession({
      ...buildCheckoutInput(), idempotencyKey: oversizedKey,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_INPUT_INVALID' });
    await expect(createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'PREMIUM',
      idempotencyKey: oversizedKey, envSource,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_INPUT_INVALID' });
    await expect(createPlatformBillingPortalSession({
      contaId: 'conta_1', returnUrl: 'https://app.alusa.test/account/billing-plan',
      idempotencyKey: oversizedKey, envSource,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_INPUT_INVALID' });
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).not.toHaveBeenCalled();
    expect(stripeGateway.createPortalSession).not.toHaveBeenCalled();
  });

  it('cria sessão de portal para account com Stripe customer', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'ACTIVE',
        planCode: 'STARTER',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_test_1',
        stripePriceId: 'price_starter_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        trialWillEndNotifiedAt: null,
        accessStatus: 'ACTIVE',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingPortalSession(
      {
        contaId: 'conta_1',
        returnUrl: 'https://app.alusa.test/billing',
        actorUserId: 'user_1',
        idempotencyKey: 'idem_portal_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.portalUrl).toBe('https://billing.stripe.test/session');
    expect(stripeGateway.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test_1' }),
    );
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_PORTAL_SESSION_CREATED');
  });

  it('rejeita portal quando não há Stripe customer local', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'NOT_STARTED',
        planCode: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        trialWillEndNotifiedAt: null,
        accessStatus: 'PENDING',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);

    await expect(
      createPlatformBillingPortalSession(
        {
          contaId: 'conta_1',
          returnUrl: 'https://app.alusa.test/billing',
          idempotencyKey: 'idem_portal_2',
          envSource,
        },
        { store, stripeGateway: createStripeGatewayMock() },
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_MISSING' });
  });
});

function buildCheckoutInput() {
  return {
    contaId: 'conta_1',
    contaName: 'Escola Alusa',
    planCode: 'STARTER',
    successUrl: 'https://app.alusa.test/billing/success',
    cancelUrl: 'https://app.alusa.test/billing/cancel',
    idempotencyKey: 'idem_1',
    envSource,
  };
}

function createStripeGatewayMock(): PlatformBillingStripeGateway {
  return {
    createCustomer: vi.fn(async () => ({ id: 'cus_test_1', livemode: false })),
    createCheckoutSession: vi.fn(async () => ({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.test/session',
      expiresAt: new Date('2026-06-28T12:00:00.000Z'),
    })),
    createTrialSubscriptionWithoutPaymentMethod: vi.fn(async () => ({
      id: 'sub_test_trial_1',
      customerId: 'cus_test_1',
      status: 'trialing',
      priceId: 'price_premium_test',
      currentPeriodEnd: new Date('2026-07-15T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      pendingUpdateId: null,
    })),
    createPortalSession: vi.fn(async () => ({
      id: 'bps_test_1',
      url: 'https://billing.stripe.test/session',
    })),
  };
}

function createMemoryStore(initialAccounts: PlatformBillingAccountRecord[] = []) {
  const accounts = [...initialAccounts];
  const checkoutSessions: PlatformBillingCheckoutSessionRecord[] = [];
  const invoices: PlatformBillingInvoiceRecord[] = [];
  const webhookEvents: PlatformBillingWebhookEventRecord[] = [];
  const auditLogs: PlatformBillingAuditLogInput[] = [];
  const checkoutClaims = new Map<string, { key: string; phase: 'CLAIMED' | 'REQUESTING' }>();

  const store: PlatformBillingStore & {
    accounts: PlatformBillingAccountRecord[];
    checkoutSessions: PlatformBillingCheckoutSessionRecord[];
    invoices: PlatformBillingInvoiceRecord[];
    webhookEvents: PlatformBillingWebhookEventRecord[];
    auditLogs: PlatformBillingAuditLogInput[];
  } = {
    accounts,
    checkoutSessions,
    invoices,
    webhookEvents,
    auditLogs,
    async findAccount(input) {
      return (
        accounts.find(
          (account) => account.contaId === input.contaId && account.environment === input.environment,
        ) ?? null
      );
    },
    async findAccountByStripeCustomerId(input) {
      return (
        accounts.find(
          (account) =>
            account.environment === input.environment &&
            account.stripeCustomerId === input.stripeCustomerId,
        ) ?? null
      );
    },
    async findAccountByStripeSubscriptionId(input) {
      return (
        accounts.find(
          (account) =>
            account.environment === input.environment &&
            account.stripeSubscriptionId === input.stripeSubscriptionId,
        ) ?? null
      );
    },
    async createAccount(input) {
      const account: PlatformBillingAccountRecord = {
        id: `pba_${accounts.length + 1}`,
        contaId: input.contaId,
        environment: input.environment,
        status: 'NOT_STARTED',
        planCode: null,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        accessStatus: 'PENDING',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      };
      accounts.push(account);
      return account;
    },
    async attachCustomer(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      account.stripeCustomerId = input.stripeCustomerId;
      return account;
    },
    async reserveTrialSubscriptionClaim(input) {
      let account = accounts.find((item) => item.contaId === input.contaId && item.environment === input.environment);
      if (!account) {
        account = {
          id: `pba_${accounts.length + 1}`,
          contaId: input.contaId,
          environment: input.environment,
          status: 'NOT_STARTED',
          planCode: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEndsAt: null,
          accessStatus: 'PENDING',
          gracePeriodEndsAt: null,
          restrictedAt: null,
          canceledAt: null,
          lastPaymentFailedAt: null,
          pendingPlanCode: null,
          pendingChangeType: null,
          pendingChangeEffectiveAt: null,
        };
        accounts.push(account);
      }
      if (account.stripeSubscriptionId || account.trialEndsAt) return account;
      const currentKey = account.trialSubscriptionClaimKey;
      const staleClaim = account.trialSubscriptionClaimPhase === 'CLAIMED'
        && account.trialSubscriptionClaimedAt instanceof Date
        && account.trialSubscriptionClaimedAt.getTime() < Date.now() - 5 * 60_000;
      if (currentKey && currentKey !== input.idempotencyKey && !staleClaim) {
        throw new PlatformBillingError(
          'Trial claim conflict',
          account.trialSubscriptionClaimPhase === 'REQUESTING'
            ? 'PLATFORM_BILLING_RECONCILIATION_FAILED'
            : 'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        );
      }
      if (currentKey === input.idempotencyKey && account.trialSubscriptionClaimPhase === 'REQUESTING'
        && account.trialSubscriptionRequestExpiresAt
        && account.trialSubscriptionRequestExpiresAt.getTime() <= Date.now()) {
        throw new PlatformBillingError('Trial request requires reconciliation', 'PLATFORM_BILLING_RECONCILIATION_FAILED');
      }
      account.trialSubscriptionClaimKey = input.idempotencyKey;
      account.trialSubscriptionClaimPhase ||= 'CLAIMED';
      account.trialSubscriptionClaimedAt ||= new Date();
      return account;
    },
    async markTrialSubscriptionRequestStarted(input) {
      const account = accounts.find((item) => item.contaId === input.contaId && item.environment === input.environment);
      if (!account || account.trialSubscriptionClaimKey !== input.idempotencyKey) throw new Error('trial claim missing');
      account.trialSubscriptionClaimPhase = 'REQUESTING';
      account.trialSubscriptionRequestExpiresAt = new Date(Date.now() + 20 * 60 * 60_000);
    },
    async releaseTrialSubscriptionClaim(input) {
      const account = accounts.find((item) => item.contaId === input.contaId && item.environment === input.environment);
      if (!account || account.trialSubscriptionClaimKey !== input.idempotencyKey) return;
      account.trialSubscriptionClaimKey = null;
      account.trialSubscriptionClaimPhase = null;
      account.trialSubscriptionClaimedAt = null;
      account.trialSubscriptionRequestExpiresAt = null;
    },
    async markCheckoutPending(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      if (account.trialSubscriptionClaimKey) {
        throw new PlatformBillingError('Trial claim conflict', 'PLATFORM_BILLING_CHECKOUT_IN_PROGRESS');
      }
      const currentClaim = checkoutClaims.get(input.accountId);
      if (currentClaim && !(currentClaim.key === input.idempotencyKey && currentClaim.phase === 'REQUESTING')) {
        throw new PlatformBillingError('Checkout claim conflict', 'PLATFORM_BILLING_CHECKOUT_IN_PROGRESS');
      }
      if (!currentClaim) checkoutClaims.set(input.accountId, { key: input.idempotencyKey, phase: 'CLAIMED' });
      if (input.pendingChangeType === 'REACTIVATE') {
        account.status = 'CANCELED';
        account.accessStatus = 'CANCELED';
      } else {
        account.status = 'CHECKOUT_PENDING';
        account.accessStatus = 'PENDING';
      }
      account.pendingPlanCode = input.planCode;
      account.pendingChangeType = input.pendingChangeType ?? null;
      account.pendingChangeEffectiveAt = null;
      return account;
    },
    async markCheckoutRequestStarted(input) {
      const claim = checkoutClaims.get(input.accountId);
      if (!claim || claim.key !== input.idempotencyKey) throw new Error('claim missing');
      claim.phase = 'REQUESTING';
    },
    async updateAccountFromStripeSubscription(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      account.status = input.status;
      account.planCode = input.planCode;
      account.stripeSubscriptionId = input.stripeSubscriptionId;
      account.stripePriceId = input.stripePriceId;
      account.currentPeriodEnd = input.currentPeriodEnd;
      account.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
      account.trialEndsAt = input.trialEndsAt;
      if (input.stripeSubscriptionId) {
        account.trialSubscriptionClaimKey = null;
        account.trialSubscriptionClaimPhase = null;
        account.trialSubscriptionClaimedAt = null;
        account.trialSubscriptionRequestExpiresAt = null;
      }
      account.trialWillEndNotifiedAt = input.trialWillEndNotifiedAt === undefined ? account.trialWillEndNotifiedAt : input.trialWillEndNotifiedAt;
      account.accessStatus = input.accessStatus ?? account.accessStatus;
      account.gracePeriodEndsAt = input.gracePeriodEndsAt === undefined ? account.gracePeriodEndsAt : input.gracePeriodEndsAt;
      account.restrictedAt = input.restrictedAt === undefined ? account.restrictedAt : input.restrictedAt;
      account.canceledAt = input.canceledAt === undefined ? account.canceledAt : input.canceledAt;
      account.lastPaymentFailedAt = input.lastPaymentFailedAt === undefined ? account.lastPaymentFailedAt : input.lastPaymentFailedAt;
      account.pendingPlanCode = input.pendingPlanCode === undefined ? account.pendingPlanCode : input.pendingPlanCode;
      account.pendingChangeType = input.pendingChangeType === undefined ? account.pendingChangeType : input.pendingChangeType;
      account.pendingChangeEffectiveAt = input.pendingChangeEffectiveAt === undefined ? account.pendingChangeEffectiveAt : input.pendingChangeEffectiveAt;
      return account;
    },
    async findCheckoutSessionByIdempotencyKey(input) {
      return (
        checkoutSessions.find(
          (session) =>
            session.contaId === input.contaId &&
            session.environment === input.environment &&
            session.idempotencyKey === input.idempotencyKey,
        ) ?? null
      );
    },
    async createCheckoutSession(input) {
      const session: PlatformBillingCheckoutSessionRecord = {
        id: `pbcs_${checkoutSessions.length + 1}`,
        contaId: input.contaId,
        billingAccountId: input.billingAccountId,
        environment: input.environment,
        planCode: input.planCode,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripeCustomerId: input.stripeCustomerId,
        stripePriceId: input.stripePriceId,
        status: 'CREATED',
        url: input.url,
        idempotencyKey: input.idempotencyKey,
      };
      checkoutSessions.push(session);
      return session;
    },
    async listInvoices(input) {
      return invoices
        .filter((invoice) => invoice.contaId === input.contaId && invoice.environment === input.environment)
        .slice(0, input.limit ?? 24);
    },
    async upsertInvoice(input) {
      const current = invoices.find(
        (invoice) =>
          invoice.environment === input.environment &&
          invoice.stripeInvoiceId === input.stripeInvoiceId,
      );
      const next: PlatformBillingInvoiceRecord = {
        id: current?.id ?? `pbi_${invoices.length + 1}`,
        contaId: input.contaId,
        billingAccountId: input.billingAccountId ?? null,
        environment: input.environment,
        stripeInvoiceId: input.stripeInvoiceId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripePriceId: input.stripePriceId ?? null,
        planCode: input.planCode ?? null,
        number: input.number ?? null,
        status: input.status,
        amountDue: input.amountDue,
        amountPaid: input.amountPaid,
        currency: input.currency,
        hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
        invoicePdf: input.invoicePdf ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        dueDate: input.dueDate ?? null,
        paidAt: input.paidAt ?? null,
      };
      if (current) Object.assign(current, next);
      else invoices.push(next);
      return current ?? next;
    },
    async upsertWebhookEvent(input) {
      const current = webhookEvents.find(
        (event) => event.environment === input.environment && event.eventId === input.eventId,
      );
      if (current) return { record: current, inserted: false };
      const event: PlatformBillingWebhookEventRecord = {
        id: `pbwe_${webhookEvents.length + 1}`,
        environment: input.environment,
        eventId: input.eventId,
        eventType: input.eventType,
        contaId: input.contaId ?? null,
        status: 'RECEIVED',
        attempts: 0,
      };
      webhookEvents.push(event);
      return { record: event, inserted: true };
    },
    async markWebhookEventProcessing(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSING';
      event.contaId = input.contaId ?? event.contaId;
      event.attempts += 1;
      return event;
    },
    async markWebhookEventProcessed(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSED';
      event.contaId = input.contaId ?? event.contaId;
      return event;
    },
    async markWebhookEventIgnored(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'IGNORED';
      event.contaId = input.contaId ?? event.contaId;
      return event;
    },
    async markWebhookEventFailed(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'FAILED';
      event.contaId = input.contaId ?? event.contaId;
      return event;
    },
    async createAuditLog(input) {
      auditLogs.push(input);
    },
  };

  return store;
}
