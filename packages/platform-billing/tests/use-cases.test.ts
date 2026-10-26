import { describe, expect, it, vi } from 'vitest';
import {
  PlatformBillingError,
  createPrismaPlatformBillingStore,
  createPlatformBillingCheckoutSession,
  cancelPlatformBillingCheckoutReturn,
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
  STRIPE_PRICE_BAND_001_025_MONTHLY: 'price_starter_test',
  STRIPE_PRICE_BAND_026_050_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_BAND_151_200_MONTHLY: 'price_band_151_200_test',
};

function buildCheckoutReturnAccount(contaId = 'conta_a', billingAccountId = 'billing_a', claimKey = 'request-a') {
  return {
    id: billingAccountId,
    contaId,
    environment: 'TEST' as const,
    stripeCustomerId: `cus_${contaId}`,
    stripeSubscriptionId: null,
    status: 'CHECKOUT_PENDING' as const,
    planCode: null,
    accessStatus: 'PENDING' as const,
    pendingPlanCode: 'BAND_001_025' as const,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
    checkoutClaimKey: claimKey,
    checkoutClaimPhase: 'REQUESTING',
  };
}

function buildCheckoutReturnSession(
  contaId = 'conta_a',
  billingAccountId = 'billing_a',
  idempotencyKey = 'request-a',
): PlatformBillingCheckoutSessionRecord {
  return {
    id: `session_${contaId}`,
    contaId,
    billingAccountId,
    environment: 'TEST',
    planCode: 'BAND_001_025',
    stripeCheckoutSessionId: `cs_${contaId}`,
    stripeCustomerId: `cus_${contaId}`,
    stripePriceId: 'price_starter_test',
    status: 'CREATED',
    url: `https://checkout.stripe.test/${contaId}`,
    cancelUrl: `https://app.alusa.test/cancel?studentCount=1&checkoutRequestKey=${idempotencyKey}`,
    idempotencyKey,
  };
}

describe('@alusa/platform-billing use cases', () => {
  it.each([
    ['open', 'CANCELED', true],
    ['expired', 'CANCELED', false],
    ['complete', 'PENDING', false],
    ['unknown', 'PENDING', false],
  ] as const)('handles canceled Checkout return for remote %s session', async (remoteStatus, expected, expire) => {
    const account = buildCheckoutReturnAccount();
    const checkout = buildCheckoutReturnSession();
    let status = remoteStatus;
    const clearCheckoutClaim = vi.fn(async () => true);
    const markCheckoutSessionExpired = vi.fn(async () => undefined);
    const createAuditLog = vi.fn();
    const retrieveCheckoutSession = vi.fn(async () => checkoutRemote(checkout, checkout.stripeCheckoutSessionId, status));
    const expireCheckoutSession = vi.fn(async () => { status = 'expired'; });
    const result = await cancelPlatformBillingCheckoutReturn({ contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource }, {
      store: {
        findAccount: vi.fn(async () => account),
        findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
        clearCheckoutClaim,
        markCheckoutSessionExpired,
        createAuditLog,
      } as unknown as PlatformBillingStore,
      stripeGateway: { retrieveCheckoutSession, expireCheckoutSession } as unknown as PlatformBillingStripeGateway,
    });
    expect(result).toBe(expected);
    expect(expireCheckoutSession).toHaveBeenCalledTimes(expire ? 1 : 0);
    expect(clearCheckoutClaim).toHaveBeenCalledTimes(expected === 'CANCELED' ? 1 : 0);
    expect(markCheckoutSessionExpired).toHaveBeenCalledTimes(expected === 'CANCELED' ? 1 : 0);
    expect(createAuditLog).toHaveBeenCalledTimes(expected === 'CANCELED' ? 1 : 0);
  });

  it('maps a persisted requesting claim, expires and clears it tenant-scoped, then permits a retry for a canceled legacy subscription', async () => {
    const account: Record<string, unknown> = {
      id: 'billing_legacy', contaId: 'conta_a', environment: 'TEST', status: 'CANCELED',
      planCode: 'PREMIUM', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_old', stripePriceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, trialWillEndNotifiedAt: null,
      accessStatus: 'RESTRICTED', gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null,
      lastPaymentFailedAt: null, firstPaidAt: null, lastSuccessfulPaymentAt: null,
      paymentMethodStatus: 'UNKNOWN', paymentMethodType: null, paymentMethodBrand: null,
      paymentMethodLast4: null, paymentMethodExpMonth: null, paymentMethodExpYear: null,
      restrictionReason: null, gracePeriodStartedAt: null, accessStateVersion: 0,
      lastProviderEventCreatedAt: null, lastStripeEventId: null, lastReconciledAt: null,
      pendingPlanCode: 'BAND_001_025', pendingChangeType: null, pendingChangeEffectiveAt: null,
      pendingChangeOperationId: null, pendingChangeClaimToken: null,
      trialSubscriptionClaimKey: null, trialSubscriptionClaimPhase: null,
      trialSubscriptionClaimedAt: null, trialSubscriptionRequestExpiresAt: null,
      checkoutClaimKey: 'request_a', checkoutClaimPhase: 'REQUESTING',
      checkoutClaimedAt: new Date('2026-10-25T10:00:00Z'),
      checkoutRequestExpiresAt: new Date('2026-10-26T06:00:00Z'),
    };
    const checkout = {
      id: 'session_a', contaId: 'conta_a', billingAccountId: 'billing_legacy', environment: 'TEST',
      planCode: 'BAND_001_025', stripeCheckoutSessionId: 'cs_a', stripeCustomerId: 'cus_a',
      stripePriceId: 'price_starter_test', status: 'CREATED', url: null,
      cancelUrl: 'https://app.alusa.test/cancel?studentCount=1', idempotencyKey: 'request_a',
    };
    const updateMany = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.checkoutClaimKey !== undefined && where.checkoutClaimKey !== account.checkoutClaimKey) return { count: 0 };
      if (where.status === 'CHECKOUT_PENDING' && account.status !== 'CHECKOUT_PENDING') return { count: 0 };
      if (where.status?.notIn && (where.status.notIn as string[]).includes(String(account.status))) return { count: 0 };
      if (where.AND && account.checkoutClaimKey !== null && account.checkoutClaimPhase !== 'CLAIMED') return { count: 0 };
      Object.assign(account, data);
      return { count: 1 };
    });
    const store = createPrismaPlatformBillingStore({
      platformBillingAccount: {
        findUnique: vi.fn(async () => account),
        findUniqueOrThrow: vi.fn(async () => account),
        updateMany,
      },
      platformBillingCheckoutSession: {
        findUnique: vi.fn(async () => checkout),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      platformBillingAuditLog: { createMany: vi.fn(async () => ({ count: 1 })) },
    } as never);
    let stripeStatus = 'open';
    const persistedCheckout = buildCheckoutReturnSession('conta_a', 'billing_legacy', 'request_a');
    Object.assign(persistedCheckout, { id: 'session_a', stripeCheckoutSessionId: 'cs_a', stripeCustomerId: 'cus_a' });
    const stripeGateway = {
      retrieveCheckoutSession: vi.fn(async () => checkoutRemote(persistedCheckout, 'cs_a', stripeStatus)),
      expireCheckoutSession: vi.fn(async () => { stripeStatus = 'expired'; }),
    } as unknown as PlatformBillingStripeGateway;

    const mapped = await store.findAccount({ contaId: 'conta_a', environment: 'TEST' });
    expect(mapped).toMatchObject({
      checkoutClaimKey: 'request_a', checkoutClaimPhase: 'REQUESTING',
      checkoutClaimedAt: account.checkoutClaimedAt, checkoutRequestExpiresAt: account.checkoutRequestExpiresAt,
    });
    checkout.planCode = 'BAND_001_025';
    checkout.stripePriceId = 'price_starter_test';
    checkout.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1&checkoutRequestKey=request_a';
    account.pendingPlanCode = 'BAND_001_025';
    await expect(cancelPlatformBillingCheckoutReturn({ contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request_a', envSource }, {
      store, stripeGateway,
    })).resolves.toBe('CANCELED');
    expect(stripeGateway.expireCheckoutSession).toHaveBeenCalledWith('cs_a');
    expect(account).toMatchObject({ checkoutClaimKey: null, checkoutClaimPhase: null });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta_a', environment: 'TEST', checkoutClaimKey: 'request_a' }),
    }));
    await expect(store.markCheckoutPending({
      accountId: 'billing_legacy', contaId: 'conta_a', environment: 'TEST', planCode: 'PREMIUM',
      idempotencyKey: 'request_b', pendingChangeType: null,
    })).resolves.toMatchObject({ checkoutClaimKey: 'request_b', checkoutClaimPhase: 'CLAIMED' });
  });

  it('classifies a still active Stripe subscription as a duplicate checkout blocker', async () => {
    const account = {
      id: 'billing_active', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE',
      stripeSubscriptionId: 'sub_active', checkoutClaimKey: null, checkoutClaimPhase: null,
    };
    const store = createPrismaPlatformBillingStore({
      platformBillingAccount: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUniqueOrThrow: vi.fn(async () => account),
      },
    } as never);

    await expect(store.markCheckoutPending({
      accountId: 'billing_active', contaId: 'conta_a', environment: 'TEST', planCode: 'PREMIUM',
      idempotencyKey: 'request_new', pendingChangeType: null,
    })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' });
  });

  it('keeps the tenant claim when Stripe cannot confirm or expire the session, and duplicate returns converge', async () => {
    const accountRecord = buildCheckoutReturnAccount();
    const sessionRecord = buildCheckoutReturnSession();
    const clearCheckoutClaim = vi.fn(async () => true);
    const findAccount = vi.fn(async ({ contaId }: { contaId: string }) => contaId === 'conta_a'
      ? accountRecord
      : null);
    const store = {
      findAccount,
      findCheckoutSessionByIdempotencyKey: vi.fn(async ({ contaId }: { contaId: string }) => contaId === 'conta_a'
        ? sessionRecord
        : null),
      clearCheckoutClaim,
      markCheckoutSessionExpired: vi.fn(async () => undefined),
      createAuditLog: vi.fn(),
    } as unknown as PlatformBillingStore;
    const gateway = {
      retrieveCheckoutSession: vi.fn(async () => { throw new Error('Stripe unavailable'); }),
      expireCheckoutSession: vi.fn(),
    } as unknown as PlatformBillingStripeGateway;
    await expect(cancelPlatformBillingCheckoutReturn({ contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource }, { store, stripeGateway: gateway })).rejects.toThrow('Stripe unavailable');
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
    expect(await cancelPlatformBillingCheckoutReturn({ contaId: 'conta_b', environment: 'TEST', actorUserId: 'user_b', idempotencyKey: 'request-b' }, { store, stripeGateway: gateway })).toBe('ALREADY_CANCELED');
    expect(findAccount).toHaveBeenLastCalledWith({ contaId: 'conta_b', environment: 'TEST' });
  });

  it('cancels only the selected Conta claim and session when two tenants have open Checkouts', async () => {
    const accounts = {
      conta_a: buildCheckoutReturnAccount('conta_a', 'billing_a', 'request-a'),
      conta_b: buildCheckoutReturnAccount('conta_b', 'billing_b', 'request-b'),
    };
    const sessions = {
      'conta_a:request-a': buildCheckoutReturnSession('conta_a', 'billing_a', 'request-a'),
      'conta_b:request-b': buildCheckoutReturnSession('conta_b', 'billing_b', 'request-b'),
    };
    const clearCheckoutClaim = vi.fn(async ({ contaId, idempotencyKey }: { contaId: keyof typeof accounts; idempotencyKey: string }) => {
      const account = accounts[contaId];
      if (account.checkoutClaimKey !== idempotencyKey) return false;
      account.checkoutClaimKey = null;
      return true;
    });
    const createAuditLog = vi.fn();
    const store = {
      findAccount: vi.fn(async ({ contaId }: { contaId: keyof typeof accounts }) => accounts[contaId]),
      findCheckoutSessionByIdempotencyKey: vi.fn(async ({ contaId, idempotencyKey }: { contaId: keyof typeof accounts; idempotencyKey: string }) => sessions[`${contaId}:${idempotencyKey}` as keyof typeof sessions]),
      clearCheckoutClaim,
      markCheckoutSessionExpired: vi.fn(async () => undefined),
      createAuditLog,
    } as unknown as PlatformBillingStore;
    let remoteStatus = 'open';
    const retrieveCheckoutSession = vi.fn(async (id: string) => checkoutRemote(sessions[`conta_a:request-a`], id, remoteStatus));
    const expireCheckoutSession = vi.fn(async (_id: string) => { remoteStatus = 'expired'; });
    const result = await cancelPlatformBillingCheckoutReturn({ contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource }, {
      store,
      stripeGateway: { retrieveCheckoutSession, expireCheckoutSession } as unknown as PlatformBillingStripeGateway,
    });

    expect(result).toBe('CANCELED');
    expect(retrieveCheckoutSession).toHaveBeenCalledTimes(3);
    expect(retrieveCheckoutSession).toHaveBeenCalledWith('cs_conta_a');
    expect(expireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(expireCheckoutSession).toHaveBeenCalledWith('cs_conta_a');
    expect(clearCheckoutClaim).toHaveBeenCalledTimes(1);
    expect(clearCheckoutClaim).toHaveBeenCalledWith({ contaId: 'conta_a', environment: 'TEST', idempotencyKey: 'request-a' });
    expect(accounts.conta_a.checkoutClaimKey).toBeNull();
    expect(accounts.conta_b.checkoutClaimKey).toBe('request-b');
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta_a', billingAccountId: 'billing_a' }));
  });

  it('keeps the claim and skips audit for an unexpected Stripe Checkout status', async () => {
    const clearCheckoutClaim = vi.fn(async () => true);
    const createAuditLog = vi.fn();
    const account = buildCheckoutReturnAccount();
    const checkout = buildCheckoutReturnSession();
    const result = await cancelPlatformBillingCheckoutReturn({ contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource }, {
      store: {
        findAccount: vi.fn(async () => account),
        findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
        clearCheckoutClaim,
        markCheckoutSessionExpired: vi.fn(async () => undefined),
        createAuditLog,
      } as unknown as PlatformBillingStore,
      stripeGateway: {
        retrieveCheckoutSession: vi.fn(async () => checkoutRemote(checkout, checkout.stripeCheckoutSessionId, 'processing')),
        expireCheckoutSession: vi.fn(),
      } as unknown as PlatformBillingStripeGateway,
    });
    expect(result).toBe('PENDING');
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('ignores delayed cancel return for replaced request A while request B remains payable', async () => {
    const account = buildCheckoutReturnAccount('conta_a', 'billing_a', 'request-b');
    const checkout = buildCheckoutReturnSession('conta_a', 'billing_a', 'request-b');
    const retrieveCheckoutSession = vi.fn(async () => checkoutRemote(checkout));
    const expireCheckoutSession = vi.fn();
    const clearCheckoutClaim = vi.fn();
    const markCheckoutSessionExpired = vi.fn();
    const result = await cancelPlatformBillingCheckoutReturn({
      contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource,
    }, {
      store: {
        findAccount: vi.fn(async () => account),
        findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
        clearCheckoutClaim,
        markCheckoutSessionExpired,
        createAuditLog: vi.fn(),
      } as unknown as PlatformBillingStore,
      stripeGateway: { retrieveCheckoutSession, expireCheckoutSession } as unknown as PlatformBillingStripeGateway,
    });

    expect(result).toBe('STALE');
    expect(account.checkoutClaimKey).toBe('request-b');
    expect(checkout.status).toBe('CREATED');
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(expireCheckoutSession).not.toHaveBeenCalled();
    expect(markCheckoutSessionExpired).not.toHaveBeenCalled();
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
  });

  it('does not process a key when the persisted session cancel URL has no matching request identity', async () => {
    const account = buildCheckoutReturnAccount();
    const checkout = buildCheckoutReturnSession();
    checkout.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1';
    const retrieveCheckoutSession = vi.fn();
    const expireCheckoutSession = vi.fn();
    const clearCheckoutClaim = vi.fn();
    const markCheckoutSessionExpired = vi.fn();

    const result = await cancelPlatformBillingCheckoutReturn({
      contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource,
    }, {
      store: {
        findAccount: vi.fn(async () => account),
        findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
        clearCheckoutClaim,
        markCheckoutSessionExpired,
        createAuditLog: vi.fn(),
      } as unknown as PlatformBillingStore,
      stripeGateway: { retrieveCheckoutSession, expireCheckoutSession } as unknown as PlatformBillingStripeGateway,
    });

    expect(result).toBe('STALE');
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(expireCheckoutSession).not.toHaveBeenCalled();
    expect(markCheckoutSessionExpired).not.toHaveBeenCalled();
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
  });

  it('does not release the claim when the final pre-clear Stripe read is not expired', async () => {
    const account = buildCheckoutReturnAccount();
    const checkout = buildCheckoutReturnSession();
    const statuses = ['open', 'expired', 'open'];
    const retrieveCheckoutSession = vi.fn(async () => checkoutRemote(checkout, checkout.stripeCheckoutSessionId, statuses.shift() ?? 'open'));
    const expireCheckoutSession = vi.fn(async () => undefined);
    const clearCheckoutClaim = vi.fn();
    const markCheckoutSessionExpired = vi.fn();
    const result = await cancelPlatformBillingCheckoutReturn({
      contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource,
    }, {
      store: {
        findAccount: vi.fn(async () => account),
        findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
        clearCheckoutClaim,
        markCheckoutSessionExpired,
        createAuditLog: vi.fn(),
      } as unknown as PlatformBillingStore,
      stripeGateway: { retrieveCheckoutSession, expireCheckoutSession } as unknown as PlatformBillingStripeGateway,
    });

    expect(result).toBe('PENDING');
    expect(retrieveCheckoutSession).toHaveBeenCalledTimes(3);
    expect(markCheckoutSessionExpired).not.toHaveBeenCalled();
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
  });

  it.each(['tenant', 'customer', 'environment', 'price'] as const)(
    'does not expire or release a cancel-return claim when the remote %s binding mismatches', async (mismatch) => {
      const account = buildCheckoutReturnAccount();
      const checkout = buildCheckoutReturnSession();
      const remote = checkoutRemote(checkout);
      if (mismatch === 'tenant') remote.metadata.contaId = 'another-tenant';
      if (mismatch === 'customer') remote.customerId = 'cus_another';
      if (mismatch === 'environment') remote.livemode = true;
      if (mismatch === 'price') remote.priceIds = ['price_premium_test'];
      const expireCheckoutSession = vi.fn();
      const clearCheckoutClaim = vi.fn();
      const result = await cancelPlatformBillingCheckoutReturn({
        contaId: 'conta_a', environment: 'TEST', actorUserId: 'user_a', idempotencyKey: 'request-a', envSource,
      }, {
        store: {
          findAccount: vi.fn(async () => account),
          findCheckoutSessionByIdempotencyKey: vi.fn(async () => checkout),
          clearCheckoutClaim,
          markCheckoutSessionExpired: vi.fn(),
          createAuditLog: vi.fn(),
        } as unknown as PlatformBillingStore,
        stripeGateway: {
          retrieveCheckoutSession: vi.fn(async () => remote),
          expireCheckoutSession,
        } as unknown as PlatformBillingStripeGateway,
      });

      expect(result).toBe('PENDING');
      expect(expireCheckoutSession).not.toHaveBeenCalled();
      expect(clearCheckoutClaim).not.toHaveBeenCalled();
    },
  );

  it('retries after an ambiguous expire timeout and clears only after Stripe reports expired', async () => {
    const accountRecord = buildCheckoutReturnAccount();
    const sessionRecord = buildCheckoutReturnSession();
    sessionRecord.stripeCheckoutSessionId = 'cs_a';
    let remoteStatus = 'open';
    let claimActive = true;
    let confirmationReadFailed = false;
    const clearCheckoutClaim = vi.fn(async () => {
      if (!claimActive) return false;
      claimActive = false;
      return true;
    });
    const store = {
      findAccount: vi.fn(async () => claimActive
        ? accountRecord
        : { ...accountRecord, checkoutClaimKey: null, checkoutClaimPhase: null }),
      findCheckoutSessionByIdempotencyKey: vi.fn(async () => sessionRecord),
      clearCheckoutClaim,
      markCheckoutSessionExpired: vi.fn(async () => undefined),
      createAuditLog: vi.fn(),
    } as unknown as PlatformBillingStore;
    const stripeGateway = {
      retrieveCheckoutSession: vi.fn(async () => {
        if (remoteStatus === 'expired' && !confirmationReadFailed) {
          confirmationReadFailed = true;
          throw new Error('Stripe confirmation temporarily unavailable');
        }
        return checkoutRemote(sessionRecord, 'cs_a', remoteStatus);
      }),
      expireCheckoutSession: vi.fn(async () => {
        remoteStatus = 'expired';
        throw new Error('timeout after Stripe may have expired the session');
      }),
    } as unknown as PlatformBillingStripeGateway;
    const input = { contaId: 'conta_a', environment: 'TEST' as const, actorUserId: 'user_a', idempotencyKey: 'request-a', envSource };
    await expect(cancelPlatformBillingCheckoutReturn(input, { store, stripeGateway })).rejects.toThrow('confirmation temporarily unavailable');
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
    expect(await cancelPlatformBillingCheckoutReturn(input, { store, stripeGateway })).toBe('CANCELED');
    expect(clearCheckoutClaim).toHaveBeenCalledTimes(1);
  });

  it('converges concurrent same-tenant returns with one claim clear and one audit', async () => {
    const accountRecord = buildCheckoutReturnAccount();
    const sessionRecord = buildCheckoutReturnSession();
    sessionRecord.stripeCheckoutSessionId = 'cs_a';
    let claimActive = true;
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const initialReadsReady = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
    let expired = false;
    let expireCalls = 0;
    const audit = vi.fn();
    const clearCheckoutClaim = vi.fn(async () => {
      if (!claimActive) return false;
      claimActive = false;
      return true;
    });
    const store = {
      findAccount: vi.fn(async () => accountRecord),
      findCheckoutSessionByIdempotencyKey: vi.fn(async () => sessionRecord),
      clearCheckoutClaim,
      markCheckoutSessionExpired: vi.fn(async () => undefined),
      createAuditLog: audit,
    } as unknown as PlatformBillingStore;
    const stripeGateway = {
      retrieveCheckoutSession: vi.fn(async () => {
        initialReads += 1;
        if (initialReads <= 2) {
          if (initialReads === 2) releaseInitialReads();
          await initialReadsReady;
          return checkoutRemote(sessionRecord, 'cs_a', 'open');
        }
        return checkoutRemote(sessionRecord, 'cs_a', expired ? 'expired' : 'open');
      }),
      expireCheckoutSession: vi.fn(async () => {
        expireCalls += 1;
        if (expired) throw new Error('Checkout Session is no longer open');
        expired = true;
        if (expireCalls > 1) throw new Error('Checkout Session is no longer open');
      }),
    } as unknown as PlatformBillingStripeGateway;
    const input = { contaId: 'conta_a', environment: 'TEST' as const, actorUserId: 'user_a', idempotencyKey: 'request-a', envSource };
    await expect(Promise.all([
      cancelPlatformBillingCheckoutReturn(input, { store, stripeGateway }),
      cancelPlatformBillingCheckoutReturn(input, { store, stripeGateway }),
    ])).resolves.toEqual(['CANCELED', 'CANCELED']);
    expect(clearCheckoutClaim).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(stripeGateway.expireCheckoutSession).toHaveBeenCalledTimes(2);
    expect(stripeGateway.retrieveCheckoutSession).toHaveBeenCalledTimes(6);
  });

  it('binds the Checkout subscription only to the matching Conta, customer and request claim', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const store = createPrismaPlatformBillingStore({
      platformBillingAccount: { updateMany },
    } as never);
    await store.bindCheckoutSubscription({
      accountId: 'pba_a', contaId: 'conta_a', environment: 'TEST', stripeCustomerId: 'cus_a',
      stripeSubscriptionId: 'sub_a', idempotencyKey: 'checkout-a',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pba_a', contaId: 'conta_a', environment: 'TEST',
        stripeCustomerId: 'cus_a', checkoutClaimKey: 'checkout-a',
      },
      data: {
        stripeSubscriptionId: 'sub_a', checkoutClaimKey: null, checkoutClaimPhase: null,
        checkoutClaimedAt: null, checkoutRequestExpiresAt: null,
      },
    });
  });

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
      id: 'pba_prisma', contaId: 'conta_1', environment: 'TEST', status: 'NOT_STARTED',
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
      createPlatformBillingCheckoutSession(checkoutInputWithKey('prisma-key-a'), { store, stripeGateway }),
      createPlatformBillingCheckoutSession(checkoutInputWithKey('prisma-key-b', { planCode: 'PREMIUM' }), { store, stripeGateway }),
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
        planCode: 'BAND_001_025',
        successUrl: 'https://app.alusa.test/billing/success',
        cancelUrl: 'https://app.alusa.test/billing/cancel?checkoutRequestKey=idem_1',
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
        trialDays: null,
        idempotencyKey: 'alusa:TEST:conta_1:checkout:idem_1',
      }),
    );
    expect(store.auditLogs).toHaveLength(1);
    expect(store.accounts[0]?.status).toBe('CHECKOUT_PENDING');
    expect(store.accounts[0]?.planCode).toBeNull();
    expect(store.accounts[0]?.pendingPlanCode).toBe('BAND_001_025');
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
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_old_1', customerId: 'cus_test_1', status: 'canceled', priceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_test_1', deleted: false }));

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

  it('blocks reactivation when the linked Stripe subscription is still active despite local CANCELED status', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'BAND_026_050', stripeCustomerId: 'cus_test_1', stripeSubscriptionId: 'sub_active',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      lastReconciledAt: null, pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.listCustomerSubscriptions = vi.fn(async () => ({
      complete: true,
      subscriptions: [{
        id: 'sub_active', customerId: 'cus_test_1', status: 'active', livemode: false,
        metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'BAND_026_050' },
        priceIds: ['price_premium_test'],
      }],
    }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' });
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(store.checkoutSessions).toHaveLength(0);
  });

  it('fails closed when the customer has multiple validated nonterminal subscriptions', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'BAND_026_050', stripeCustomerId: 'cus_test_1', stripeSubscriptionId: null,
      stripePriceId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      lastReconciledAt: null, pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.listCustomerSubscriptions = vi.fn(async () => ({
      complete: true,
      subscriptions: ['sub_a', 'sub_b'].map((id) => ({
        id, customerId: 'cus_test_1', status: 'active', livemode: false,
        metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'BAND_026_050' },
        priceIds: ['price_premium_test'],
      })),
    }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('recupera customer Stripe legado verificado para reativar sem criar duplicata', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_legacy', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_legacy', deleted: false }));

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.retrieveSubscription).toHaveBeenCalledWith('sub_legacy');
    expect(stripeGateway.retrieveCustomer).toHaveBeenCalledWith('cus_legacy');
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_legacy' }));
    expect(store.accounts[0]?.stripeCustomerId).toBe('cus_legacy');
  });

  it('recupera customer legado para qualquer estado elegivel de reativacao', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'INCOMPLETE',
      planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_legacy', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_legacy', deleted: false }));

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.retrieveSubscription).toHaveBeenCalledWith('sub_legacy');
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_legacy' }));
    expect(store.accounts[0]?.stripeCustomerId).toBe('cus_legacy');
  });

  it.each(['subscription', 'customer'] as const)(
    'mantem retry seguro quando a leitura Stripe do %s falha transitoriamente',
    async (failedRead) => {
      const store = createMemoryStore([{
        id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
        planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
        stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
        trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
        gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
        pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
      }]);
      const stripeGateway = createStripeGatewayMock();
      stripeGateway.retrieveSubscription = vi.fn(async () => ({
        id: 'sub_legacy', customerId: 'cus_legacy', status: 'canceled', priceId: 'price_premium_test',
        currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
      }));
      stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_legacy', deleted: false }));
      const transientRead = failedRead === 'subscription'
        ? stripeGateway.retrieveSubscription
        : stripeGateway.retrieveCustomer;
      transientRead.mockRejectedValueOnce(new Error('temporary Stripe read failure'));

      await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
        .rejects.toThrow('temporary Stripe read failure');
      expect(store.accounts[0]?.stripeCustomerId).toBeNull();
      expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
      expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();

      await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
        .resolves.toMatchObject({ reused: false });
      expect(store.accounts[0]?.stripeCustomerId).toBe('cus_legacy');
      expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
      expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    },
  );

  it('bloqueia recuperacao quando a assinatura legada ainda nao esta cancelada', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_legacy', status: 'active', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE' });

    expect(stripeGateway.retrieveCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(store.accounts[0]?.stripeCustomerId).toBeNull();
  });

  it('bloqueia trial expirado com assinatura ainda em trial quando falta customer local', async () => {
    const store = createMemoryStore([{
      id: 'pba_trial', contaId: 'conta_1', environment: 'TEST', status: 'TRIALING',
      planCode: 'BAND_001_025', stripeCustomerId: null, stripeSubscriptionId: 'sub_trial',
      stripePriceId: 'price_starter_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: new Date(Date.now() - 60_000), trialWillEndNotifiedAt: null,
      accessStatus: 'RESTRICTED', gracePeriodEndsAt: null, restrictedAt: new Date(), canceledAt: null,
      lastPaymentFailedAt: null, firstPaidAt: null, lastSuccessfulPaymentAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_trial', customerId: 'cus_trial', status: 'trialing', priceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: new Date(Date.now() + 60_000),
      pendingUpdateId: null,
    }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE' });

    expect(stripeGateway.retrieveCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(store.accounts[0]?.stripeCustomerId).toBeNull();
  });

  it('recupera customer para trial expirado pausado confirmado pela Stripe', async () => {
    const expiredAt = new Date(Date.now() - 60_000);
    const store = createMemoryStore([{
      id: 'pba_trial', contaId: 'conta_1', environment: 'TEST', status: 'PAUSED',
      planCode: 'BAND_001_025', stripeCustomerId: null, stripeSubscriptionId: 'sub_trial',
      stripePriceId: 'price_starter_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: expiredAt, trialWillEndNotifiedAt: null, accessStatus: 'RESTRICTED',
      gracePeriodEndsAt: null, restrictedAt: expiredAt, canceledAt: null, lastPaymentFailedAt: null,
      firstPaidAt: null, lastSuccessfulPaymentAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_trial', customerId: 'cus_trial', status: 'paused', priceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: expiredAt, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_trial', deleted: false }));

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_trial' }));
    expect(store.accounts[0]?.stripeCustomerId).toBe('cus_trial');
  });

  it('bloqueia customer recuperado com id diferente da assinatura', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_expected', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_other', deleted: false }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE' });

    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(store.accounts[0]?.stripeCustomerId).toBeNull();
  });

  it('associa customer legado concorrente a no maximo uma conta', async () => {
    const buildLegacyAccount = (id: string, contaId: string, subscriptionId: string): PlatformBillingAccountRecord => ({
      id, contaId, environment: 'TEST', status: 'CANCELED', planCode: 'PREMIUM',
      stripeCustomerId: null, stripeSubscriptionId: subscriptionId, stripePriceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, trialWillEndNotifiedAt: null,
      accessStatus: 'CANCELED', gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null,
      lastPaymentFailedAt: null, lastReconciledAt: null, pendingPlanCode: null, pendingChangeType: null,
      pendingChangeEffectiveAt: null,
    });
    const store = createMemoryStore([
      buildLegacyAccount('pba_a', 'conta_a', 'sub_a'),
      buildLegacyAccount('pba_b', 'conta_b', 'sub_b'),
    ]);
    store.attachCustomer = vi.fn(async ({ accountId, stripeCustomerId }) => {
      const alreadyLinked = store.accounts.find((account) =>
        account.id !== accountId && account.environment === 'TEST' && account.stripeCustomerId === stripeCustomerId,
      );
      if (alreadyLinked) throw new Error('unique Stripe customer association conflict');
      const account = store.accounts.find((item) => item.id === accountId);
      if (!account) throw new Error('account not found');
      account.stripeCustomerId = stripeCustomerId;
      return account;
    });
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async (subscriptionId: string) => ({
      id: subscriptionId, customerId: 'cus_shared_legacy', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_shared_legacy', deleted: false }));

    const results = await Promise.allSettled([
      createPlatformBillingCheckoutSession({ ...buildCheckoutInput(), contaId: 'conta_a' }, { store, stripeGateway }),
      createPlatformBillingCheckoutSession({ ...buildCheckoutInput(), contaId: 'conta_b' }, { store, stripeGateway }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(store.accounts.filter((account) => account.stripeCustomerId === 'cus_shared_legacy')).toHaveLength(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
  });

  it('cria customer idempotente somente quando o customer legado foi confirmado como removido', async () => {
    const store = createMemoryStore([{
      id: 'pba_legacy', contaId: 'conta_1', environment: 'TEST', status: 'CANCELED',
      planCode: 'PREMIUM', stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED',
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_deleted', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_deleted', deleted: true }));

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_test_1' }));
    expect(store.accounts[0]?.stripeCustomerId).toBe('cus_test_1');
  });

  it('bloqueia recuperacao do customer legado associado a outra conta', async () => {
    const target = {
      id: 'pba_target', contaId: 'conta_1', environment: 'TEST' as const, status: 'CANCELED' as const,
      planCode: 'PREMIUM' as const, stripeCustomerId: null, stripeSubscriptionId: 'sub_legacy',
      stripePriceId: 'price_premium_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: null, trialWillEndNotifiedAt: null, accessStatus: 'CANCELED' as const,
      gracePeriodEndsAt: null, restrictedAt: null, canceledAt: null, lastPaymentFailedAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    };
    const other = { ...target, id: 'pba_other', contaId: 'conta_2', stripeCustomerId: 'cus_legacy', stripeSubscriptionId: null };
    const store = createMemoryStore([target, other]);
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.retrieveSubscription = vi.fn(async () => ({
      id: 'sub_legacy', customerId: 'cus_legacy', status: 'canceled', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }));
    stripeGateway.retrieveCustomer = vi.fn(async () => ({ id: 'cus_legacy', deleted: false }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE' });

    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
    expect(store.accounts.find((account) => account.id === 'pba_target')?.stripeCustomerId).toBeNull();
    expect(store.accounts.find((account) => account.id === 'pba_other')?.stripeCustomerId).toBe('cus_legacy');
  });

  it('permite checkout explicito após trial vencido mesmo antes do webhook PAUSED', async () => {
    const store = createMemoryStore([{
      id: 'pba_trial',
      contaId: 'conta_1',
      environment: 'TEST',
      status: 'TRIALING',
      planCode: 'BAND_151_200',
      stripeCustomerId: 'cus_test_1',
      stripeSubscriptionId: 'sub_trial_1',
      stripePriceId: 'price_band_151_200_test',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date(Date.now() - 60_000),
      trialWillEndNotifiedAt: null,
      firstPaidAt: null,
      lastSuccessfulPaymentAt: null,
      accessStatus: 'RESTRICTED',
      gracePeriodEndsAt: null,
      restrictedAt: new Date(),
      canceledAt: null,
      lastPaymentFailedAt: null,
      lastReconciledAt: null,
      pendingPlanCode: null,
      pendingChangeType: null,
      pendingChangeEffectiveAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession({ ...buildCheckoutInput(), planCode: 'BAND_151_200' }, { store, stripeGateway });

    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceId: 'price_band_151_200_test',
      metadata: expect.objectContaining({ flow: 'reactivation' }),
      trialDays: null,
    }));
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

  it('blocks exact-key replay when the account now has an active subscription and no claim', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = null;
    account.checkoutClaimPhase = null;
    account.status = 'ACTIVE';
    account.planCode = 'BAND_001_025';
    account.stripeSubscriptionId = 'sub_active_now';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, 'open'));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' });
    expect(stripeGateway.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(store.checkoutSessions).toHaveLength(1);
  });

  it('reuses the validated open session for a new key when the selected band and price match', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const original = await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, 'open'));

    const recovered = await createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_retry_same_band'), { store, stripeGateway });

    expect(recovered).toMatchObject({ checkoutSessionId: original.checkoutSessionId, reused: true });
    expect(stripeGateway.retrieveCheckoutSession).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the matching open pending session has no persisted URL', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    store.checkoutSessions[0]!.url = null;
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, 'open'));

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_retry_missing_url'), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });
    expect(account.checkoutClaimKey).toBe('idem_1');
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(store.checkoutSessions).toHaveLength(1);
  });

  it('concurrent same-band retries converge on the single validated open session', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const original = await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, 'open'));

    const results = await Promise.all(['idem_retry_a', 'idem_retry_b'].map((idempotencyKey) =>
      createPlatformBillingCheckoutSession(checkoutInputWithKey(idempotencyKey), { store, stripeGateway }),
    ));

    expect(results.map((result) => result.checkoutSessionId)).toEqual([original.checkoutSessionId, original.checkoutSessionId]);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('returns a dedicated fresh-key signal when the exact-key session is confirmed expired', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, 'expired'));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED' });
    expect(store.checkoutSessions[0]?.status).toBe('EXPIRED');
    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_fresh_after_expiry'), { store, stripeGateway }))
      .resolves.toMatchObject({ reused: false });
  });

  it('expires a validated open session before creating the newly selected band', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn()
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'open'))
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'expired'));
    stripeGateway.expireCheckoutSession = vi.fn(async () => undefined);
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_new_band', url: 'https://checkout.stripe.test/new-band', expiresAt: new Date(Date.now() + 60_000),
    }));

    const result = await createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_new_band', { planCode: 'BAND_026_050' }), { store, stripeGateway });

    expect(stripeGateway.expireCheckoutSession).toHaveBeenCalledWith('cs_test_1');
    expect(store.checkoutSessions[0]?.status).toBe('EXPIRED');
    expect(result).toMatchObject({ checkoutSessionId: 'cs_test_new_band', reused: false });
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenLastCalledWith(expect.objectContaining({ priceId: 'price_premium_test' }));
  });

  it('replaces same-band open Checkout when a newly confirmed student count differs', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_1', { cancelUrl: 'https://app.alusa.test/cancel?studentCount=1' }), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn()
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'open'))
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'expired'));
    stripeGateway.expireCheckoutSession = vi.fn(async () => undefined);
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_new_count', url: 'https://checkout.stripe.test/new-count', expiresAt: new Date(Date.now() + 60_000),
    }));

    const result = await createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_new_count', {
      cancelUrl: 'https://app.alusa.test/cancel?studentCount=20',
    }), { store, stripeGateway });

    expect(stripeGateway.expireCheckoutSession).toHaveBeenCalledWith('cs_test_1');
    expect(result.checkoutSessionId).toBe('cs_test_new_count');
    expect(store.checkoutSessions.at(-1)?.cancelUrl).toContain('studentCount=20');
  });

  it('replaces a same-band session whose cancel URL lacks its own request identity', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    store.checkoutSessions[0]!.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1';
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn()
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'open'))
      .mockResolvedValueOnce(checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', 'expired'));
    stripeGateway.expireCheckoutSession = vi.fn(async () => undefined);
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_correlated', url: 'https://checkout.stripe.test/correlated', expiresAt: new Date(Date.now() + 60_000),
    }));

    const result = await createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_correlated'), { store, stripeGateway });

    expect(stripeGateway.expireCheckoutSession).toHaveBeenCalledWith('cs_test_1');
    expect(result.checkoutSessionId).toBe('cs_test_correlated');
    expect(new URL(store.checkoutSessions.at(-1)!.cancelUrl).searchParams.get('checkoutRequestKey')).toBe('idem_correlated');
  });

  it('requests the bounded fresh-key retry when the expiry webhook already cleared the old claim', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    store.checkoutSessions[0]!.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1';
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    const clear = store.clearCheckoutClaim.bind(store);
    store.clearCheckoutClaim = async (input) => {
      await clear(input);
      return false;
    };
    let remoteStatus = 'open';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, remoteStatus));
    stripeGateway.expireCheckoutSession = vi.fn(async () => { remoteStatus = 'expired'; });
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_after_webhook_clear', url: 'https://checkout.stripe.test/after-webhook-clear', expiresAt: new Date(Date.now() + 60_000),
    }));

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_after_webhook_clear'), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED' });
    expect(account.checkoutClaimKey).toBeNull();
    expect(store.checkoutSessions[0]?.status).toBe('EXPIRED');
    expect(stripeGateway.retrieveCheckoutSession).toHaveBeenCalledTimes(3);
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('keeps a newer claim when the old expiry claim-clear CAS loses a race', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    store.checkoutSessions[0]!.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1';
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    const clear = store.clearCheckoutClaim.bind(store);
    store.clearCheckoutClaim = async (input) => {
      await clear(input);
      account.checkoutClaimKey = 'newer_request';
      account.checkoutClaimPhase = 'REQUESTING';
      account.pendingPlanCode = 'BAND_001_025';
      return false;
    };
    let remoteStatus = 'open';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, remoteStatus));
    stripeGateway.expireCheckoutSession = vi.fn(async () => { remoteStatus = 'expired'; });

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_after_race'), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });
    expect(account.checkoutClaimKey).toBe('newer_request');
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('blocks recovery if an active subscription appears while the expiry claim is cleared', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    store.checkoutSessions[0]!.cancelUrl = 'https://app.alusa.test/cancel?studentCount=1';
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    const clear = store.clearCheckoutClaim.bind(store);
    store.clearCheckoutClaim = async (input) => {
      await clear(input);
      account.status = 'ACTIVE';
      account.planCode = 'BAND_001_025';
      account.stripeSubscriptionId = 'sub_activated_during_expiry';
      account.accessStatus = 'ACTIVE';
      return false;
    };
    let remoteStatus = 'open';
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => checkoutRemote(store.checkoutSessions[0]!, id, remoteStatus));
    stripeGateway.expireCheckoutSession = vi.fn(async () => { remoteStatus = 'expired'; });

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_after_active_race'), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' });
    expect(account.stripeSubscriptionId).toBe('sub_activated_during_expiry');
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim and persisted session for reconciliation when new Stripe Checkout has no URL', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    const clearCheckoutClaim = vi.fn(store.clearCheckoutClaim.bind(store));
    store.clearCheckoutClaim = clearCheckoutClaim;
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_no_url', url: null, expiresAt: new Date(Date.now() + 60_000),
    }));

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });

    expect(store.checkoutSessions).toHaveLength(1);
    expect(store.checkoutSessions[0]).toMatchObject({ stripeCheckoutSessionId: 'cs_test_no_url', status: 'CREATED', url: null });
    expect(store.accounts[0]).toMatchObject({ status: 'CHECKOUT_PENDING', pendingPlanCode: 'BAND_001_025' });
    expect(clearCheckoutClaim).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent changed-band retry to replace the old payable session', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    let retrieveCount = 0;
    stripeGateway.retrieveCheckoutSession = vi.fn(async (id) => {
      retrieveCount += 1;
      return checkoutRemote(store.checkoutSessions[0]!, id, retrieveCount <= 2 ? 'open' : 'expired');
    });
    stripeGateway.expireCheckoutSession = vi.fn(async () => undefined);
    stripeGateway.createCheckoutSession = vi.fn(async () => ({
      id: 'cs_test_replacement', url: 'https://checkout.stripe.test/replacement', expiresAt: new Date(Date.now() + 60_000),
    }));

    const results = await Promise.allSettled(['idem_replacement_a', 'idem_replacement_b'].map((idempotencyKey) =>
      createPlatformBillingCheckoutSession(checkoutInputWithKey(idempotencyKey, { planCode: 'BAND_026_050' }), { store, stripeGateway }),
    ));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['complete', { idMatches: true, bindingMatches: true }],
    ['open', { idMatches: false, bindingMatches: true }],
    ['open', { idMatches: true, bindingMatches: false }],
  ] as const)('keeps the claim and blocks replacement for remote %s or mismatched binding', async (status, options) => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn(async () => ({
      ...checkoutRemote(store.checkoutSessions[0]!, 'cs_test_1', status),
      id: options.idMatches ? 'cs_test_1' : 'cs_other',
      priceIds: options.bindingMatches ? ['price_starter_test'] : ['price_premium_test'],
    }));

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_replacement', { planCode: 'BAND_026_050' }), { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });
    expect(account.checkoutClaimKey).toBe('idem_1');
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(stripeGateway.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it('fails closed without expiring or clearing the claim when retrieving the pending session fails', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const account = store.accounts[0]!;
    account.checkoutClaimKey = 'idem_1';
    account.checkoutClaimPhase = 'REQUESTING';
    account.pendingPlanCode = 'BAND_001_025';
    stripeGateway.retrieveCheckoutSession = vi.fn(async () => { throw new Error('Stripe unavailable'); });

    await expect(createPlatformBillingCheckoutSession(checkoutInputWithKey('idem_replacement', { planCode: 'BAND_026_050' }), { store, stripeGateway }))
      .rejects.toThrow('Stripe unavailable');
    expect(account.checkoutClaimKey).toBe('idem_1');
    expect(stripeGateway.expireCheckoutSession).not.toHaveBeenCalled();
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

  it('libera o claim quando Stripe rejeita Checkout sem criar sessão', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.createCheckoutSession = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid checkout request'), {
        type: 'StripeInvalidRequestError', statusCode: 400,
      }))
      .mockResolvedValueOnce({
        id: 'cs_test_retry', url: 'https://checkout.stripe.test/retry',
        expiresAt: new Date('2026-06-28T12:00:00.000Z'),
      });

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toThrow('invalid checkout request');
    expect(store.accounts[0]).toMatchObject({ status: 'NOT_STARTED', pendingPlanCode: null });
    await expect(createPlatformBillingCheckoutSession(
      checkoutInputWithKey('idem_retry'), { store, stripeGateway },
    )).resolves.toMatchObject({ checkoutSessionId: 'cs_test_retry' });
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(2);
  });

  it('preserva o claim quando a resposta do Stripe é ambígua e retoma com a mesma chave', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();
    stripeGateway.createCheckoutSession = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset after request'))
      .mockResolvedValueOnce({
        id: 'cs_test_recovered', url: 'https://checkout.stripe.test/recovered',
        expiresAt: new Date('2026-06-28T12:00:00.000Z'),
      });

    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .rejects.toThrow('connection reset after request');
    expect(store.accounts[0]?.status).toBe('CHECKOUT_PENDING');
    await expect(createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway }))
      .resolves.toMatchObject({ checkoutSessionId: 'cs_test_recovered' });
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
      checkoutInputWithKey('different-key'), { store, stripeGateway },
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
        { ...buildCheckoutInput(), planCode: 'BAND_026_050' },
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
        planCode: 'BAND_026_050',
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
      planCode: 'BAND_026_050',
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
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'BAND_026_050', idempotencyKey, envSource,
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
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'BAND_026_050', idempotencyKey, envSource,
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
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'BAND_026_050', idempotencyKey: 'idem_trial_webhook_race', envSource,
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
        planCode: 'BAND_026_050',
        idempotencyKey: 'idem_trial_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(true);
    expect(result.stripeSubscriptionId).toBe('sub_existing_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).not.toHaveBeenCalled();
  });

  it('does not restart a used trial when its end date exists but the subscription link is missing', async () => {
    const store = createMemoryStore([{
      id: 'pba_trial_orphan', contaId: 'conta_1', environment: 'TEST', status: 'RESTRICTED',
      planCode: 'BAND_001_025', stripeCustomerId: 'cus_test_1', stripeSubscriptionId: null,
      stripePriceId: 'price_starter_test', currentPeriodEnd: null, cancelAtPeriodEnd: false,
      trialEndsAt: new Date('2026-10-01T00:00:00Z'), trialWillEndNotifiedAt: null,
      accessStatus: 'RESTRICTED', gracePeriodEndsAt: null, restrictedAt: new Date('2026-10-01T00:00:00Z'),
      canceledAt: null, lastPaymentFailedAt: null, firstPaidAt: null, lastSuccessfulPaymentAt: null,
      paymentMethodStatus: 'MISSING', paymentMethodType: null, paymentMethodBrand: null,
      paymentMethodLast4: null, paymentMethodExpMonth: null, paymentMethodExpYear: null,
      restrictionReason: 'TRIAL_EXPIRED', gracePeriodStartedAt: null, accessStateVersion: 1,
      lastProviderEventCreatedAt: null, lastStripeEventId: null, lastReconciledAt: null,
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
      pendingChangeOperationId: null, pendingChangeClaimToken: null, pendingChangeClaimedAt: null,
      trialSubscriptionClaimKey: null, trialSubscriptionClaimPhase: null,
      trialSubscriptionClaimedAt: null, trialSubscriptionRequestExpiresAt: null,
    }]);
    const stripeGateway = createStripeGatewayMock();

    await expect(createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'BAND_001_025',
      idempotencyKey: 'idem_trial_orphan_link', envSource,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_BILLING_TRIAL_ALREADY_USED' });
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).not.toHaveBeenCalled();
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
  });

  it.each(['STARTER', 'PREMIUM', 'PRO'] as const)('keeps legacy plan %s out of new checkout and trial flows', async (planCode) => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await expect(createPlatformBillingCheckoutSession({ ...buildCheckoutInput(), planCode }, { store, stripeGateway }))
      .rejects.toMatchObject({ code: 'PLATFORM_PLAN_INVALID' });
    await expect(createPlatformBillingTrialWithoutPaymentMethod({
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode, idempotencyKey: `legacy_trial_${planCode}`, envSource,
    }, { store, stripeGateway })).rejects.toMatchObject({ code: 'PLATFORM_PLAN_INVALID' });
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).not.toHaveBeenCalled();
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
      contaId: 'conta_1', contaName: 'Escola Alusa', planCode: 'BAND_026_050',
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
    planCode: 'BAND_001_025',
    successUrl: 'https://app.alusa.test/billing/success',
    cancelUrl: 'https://app.alusa.test/billing/cancel?checkoutRequestKey=idem_1',
    idempotencyKey: 'idem_1',
    envSource,
  };
}

function checkoutInputWithKey(idempotencyKey: string, overrides: Partial<ReturnType<typeof buildCheckoutInput>> = {}) {
  const input = { ...buildCheckoutInput(), ...overrides, idempotencyKey };
  const cancelUrl = new URL(input.cancelUrl);
  cancelUrl.searchParams.set('checkoutRequestKey', idempotencyKey);
  return { ...input, cancelUrl: cancelUrl.toString() };
}

function checkoutRemote(
  session: PlatformBillingCheckoutSessionRecord,
  id = session.stripeCheckoutSessionId,
  status: string | null = 'open',
) {
  return {
    id,
    status,
    livemode: session.environment === 'LIVE',
    customerId: session.stripeCustomerId,
    clientReferenceId: session.contaId,
    metadata: {
      contaId: session.contaId,
      planCode: session.planCode,
      billingContext: 'platform',
      checkoutRequestKey: session.idempotencyKey,
    },
    priceIds: [session.stripePriceId],
  };
}

function createStripeGatewayMock(): PlatformBillingStripeGateway {
  return {
    listCustomerSubscriptions: vi.fn(async () => ({ subscriptions: [], complete: true })),
    retrieveCheckoutSession: vi.fn(async (id: string) => ({
      id, status: 'open', livemode: false, customerId: 'cus_test_1', clientReferenceId: 'conta_1',
      metadata: { contaId: 'conta_1', planCode: 'BAND_001_025', billingContext: 'platform', checkoutRequestKey: 'idem_1' },
      priceIds: ['price_starter_test'],
    })),
    expireCheckoutSession: vi.fn(async () => undefined),
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
    retrieveSubscription: vi.fn(async () => ({
      id: 'sub_test_1', customerId: 'cus_test_1', status: 'canceled', priceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    })),
    retrieveSubscriptionSnapshot: vi.fn(async () => ({
      id: 'sub_test_1', customerId: 'cus_test_1', status: 'canceled', livemode: false,
      metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'BAND_001_025' },
      priceIds: ['price_starter_test'],
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    })),
    retrieveCustomer: vi.fn(async (customerId: string) => ({ id: customerId, deleted: false })),
    previewSubscriptionPlanChange: vi.fn(),
    updateSubscriptionPlan: vi.fn(),
    scheduleSubscriptionPlanChange: vi.fn(),
    releaseSubscriptionSchedule: vi.fn(),
    updateSubscriptionCancelAtPeriodEnd: vi.fn(),
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
    async bindCheckoutSubscription(input) {
      const account = accounts.find((item) => item.id === input.accountId
        && item.contaId === input.contaId && item.environment === input.environment
        && item.stripeCustomerId === input.stripeCustomerId);
      const claim = checkoutClaims.get(input.accountId);
      if (!account || claim?.key !== input.idempotencyKey) return;
      account.stripeSubscriptionId = input.stripeSubscriptionId;
      checkoutClaims.delete(input.accountId);
    },
    async clearCheckoutClaim(input) {
      const account = accounts.find((item) => item.contaId === input.contaId && item.environment === input.environment);
      if (!account || checkoutClaims.get(account.id)?.key !== input.idempotencyKey) return false;
      checkoutClaims.delete(account.id);
      account.checkoutClaimKey = null;
      account.checkoutClaimPhase = null;
      account.checkoutClaimedAt = null;
      account.checkoutRequestExpiresAt = null;
      if (account.status === 'CHECKOUT_PENDING') {
        account.status = 'NOT_STARTED';
        account.accessStatus = 'PENDING';
      }
      account.pendingPlanCode = null;
      account.pendingChangeType = null;
      return true;
    },
    async markCheckoutSessionExpired(input) {
      const session = checkoutSessions.find((item) => item.contaId === input.contaId
        && item.environment === input.environment && item.idempotencyKey === input.idempotencyKey);
      if (session?.status === 'CREATED') session.status = 'EXPIRED';
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
        cancelUrl: input.cancelUrl,
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
