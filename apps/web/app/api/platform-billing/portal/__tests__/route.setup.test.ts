import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

const transactionContext = new AsyncLocalStorage<{ releaseLocks: Array<() => void> }>();
const advisoryQueues = new Map<string, Promise<void>>();

const { state, tx, stripeMocks } = vi.hoisted(() => {
  const state = {
    hasDefault: false,
    stripeFails: false,
    inTransaction: false,
    stripeCalledInTransaction: false,
    stripeGate: null as Promise<void> | null,
    stripeStarted: null as (() => void) | null,
    advisoryKeys: [] as string[],
    listedSessions: [] as Array<Record<string, unknown>>,
    listingComplete: true,
    retrievedSession: null as Record<string, unknown> | null,
    retrievedSetupIntent: null as Record<string, unknown> | null,
    accounts: {} as Record<string, { id: string; status: string; stripeCustomerId: string; stripeSubscriptionId: string; trialEndsAt: Date; firstPaidAt: Date | null; lastSuccessfulPaymentAt: Date | null }>,
    audits: [] as Array<{ id: string; data: Record<string, unknown> }>,
  };
  const tx = {
    platformBillingAccount: {
      findUnique: vi.fn(async ({ where }: { where: { uq_platform_billing_account_conta_env: { contaId: string } } }) =>
        state.accounts[where.uq_platform_billing_account_conta_env.contaId] ?? null),
      findFirst: vi.fn(async ({ where }: { where: { contaId: string; stripeCustomerId?: string } }) => {
        const account = state.accounts[where.contaId];
        return account && (!where.stripeCustomerId || account.stripeCustomerId === where.stripeCustomerId)
          ? { id: account.id } : null;
      }),
    },
      platformBillingAuditLog: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: { action: string; contaId?: string; billingAccountId?: string; correlationId?: string; entityId?: string; webhookEnvironment?: string }; orderBy?: unknown }) => {
        const matches = state.audits.filter((item) => item.data.action === where.action
          && (where.contaId === undefined || item.data.contaId === where.contaId)
          && (where.billingAccountId === undefined || item.data.billingAccountId === where.billingAccountId)
          && (where.correlationId === undefined || item.data.correlationId === where.correlationId)
          && (where.entityId === undefined || item.data.entityId === where.entityId)
          && (where.webhookEnvironment === undefined || item.data.webhookEnvironment === where.webhookEnvironment));
        return (orderBy ? matches.at(-1) : matches[0])?.data ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audits.push({ id: `audit_${state.audits.length + 1}`, data: { createdAt: new Date(), ...data } });
        return { id: `audit_${state.audits.length}` };
      }),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const key = String(values[0] ?? 'missing-advisory-key');
      state.advisoryKeys.push(key);
      const previous = advisoryQueues.get(key) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const queued = previous.then(() => held);
      advisoryQueues.set(key, queued);
      await previous;
      transactionContext.getStore()?.releaseLocks.push(() => {
        release();
        if (advisoryQueues.get(key) === queued) advisoryQueues.delete(key);
      });
      return [];
    }),
  };
  const stripeMocks = {
    hasDefault: vi.fn(async () => state.hasDefault),
    createSetup: vi.fn(async (_client: unknown, _input: { idempotencyKey: string }) => {
      if (transactionContext.getStore()) state.stripeCalledInTransaction = true;
      state.stripeStarted?.();
      if (state.stripeGate) await state.stripeGate;
      if (state.stripeFails) throw new Error('stripe unavailable');
      return { id: `cs_setup_${state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED').length + 1}`, url: 'https://stripe.test/setup', expiresAt: new Date(Date.now() + 3_600_000) };
    }),
    listSessions: vi.fn(async () => ({ sessions: state.listedSessions, complete: state.listingComplete })),
    retrieveSession: vi.fn(async () => state.retrievedSession ?? {}),
    retrieveSetupIntent: vi.fn(async () => state.retrievedSetupIntent ?? {}),
    allowRedisplay: vi.fn(async (_client: unknown, id: string) => ({ id, allow_redisplay: 'always' })),
  };
  return { state, tx, stripeMocks };
});

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: async () => ({ ok: true, contaId: 'conta_a', userId: 'user_a' }),
  withTenantSession: async () => { throw new Error('standard portal path should not execute in trial tests'); },
}));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: async (_contaId: string, callback: (client: unknown) => Promise<unknown>) => transactionContext.run({ releaseLocks: [] }, async () => {
    state.inTransaction = true;
    try { return await callback(tx); } finally {
      state.inTransaction = false;
      for (const release of transactionContext.getStore()?.releaseLocks.reverse() ?? []) release();
    }
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: () => '127.0.0.1', rateLimitAsync: async () => ({ ok: true }) }));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request_a', logApiOperationalEvent: vi.fn() }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  assertCanManagePlatformBilling: () => null,
  resolvePlatformBillingActor: async () => ({ canManagePlatformBilling: true }),
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('@alusa/stripe', () => ({
  StripeIntegrationError: class StripeIntegrationError extends Error { code = 'STRIPE_ERROR'; },
  createStripeSetupCheckoutSession: stripeMocks.createSetup,
  customerHasDefaultPaymentMethod: stripeMocks.hasDefault,
  listStripeCheckoutSessionsForCustomerSince: stripeMocks.listSessions,
  retrieveStripeSetupCheckoutSession: stripeMocks.retrieveSession,
  retrieveStripeSetupIntent: stripeMocks.retrieveSetupIntent,
  allowStripePaymentMethodRedisplay: stripeMocks.allowRedisplay,
  getStripeClient: () => ({}),
}));
vi.mock('@alusa/platform-billing', () => ({
  PlatformBillingError: class PlatformBillingError extends Error {},
  createPlatformBillingPortalSession: vi.fn(),
  createPrismaPlatformBillingStore: vi.fn(),
}));

import { POST } from '../route';

function request(key: string, consent = true) {
  return new NextRequest('https://alusa.test/api/platform-billing/portal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ savePaymentMethodConsent: consent }),
  });
}

describe('trial card Setup Checkout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.hasDefault = false;
    state.stripeFails = false;
    state.inTransaction = false;
    state.stripeCalledInTransaction = false;
    state.stripeGate = null;
    state.stripeStarted = null;
    state.audits = [];
    state.listedSessions = [];
    state.listingComplete = true;
    state.retrievedSession = null;
    state.retrievedSetupIntent = null;
    state.advisoryKeys = [];
    advisoryQueues.clear();
    state.accounts = {
      conta_a: { id: 'billing_a', status: 'TRIALING', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', trialEndsAt: new Date(Date.now() + 86_400_000), firstPaidAt: null, lastSuccessfulPaymentAt: null },
      conta_b: { id: 'billing_b', status: 'TRIALING', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b', trialEndsAt: new Date(Date.now() + 86_400_000), firstPaidAt: null, lastSuccessfulPaymentAt: null },
    };
  });

  it('requires consent before persisting intent or contacting Stripe', async () => {
    const response = await POST(request('request-no-consent', false));
    expect(response.status).toBe(400);
    expect(state.audits).toHaveLength(0);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('rejects an existing default without recording consent or creating a session', async () => {
    state.hasDefault = true;
    const response = await POST(request('request-default'));
    expect(response.status).toBe(409);
    expect(state.audits).toHaveLength(0);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('fails closed after an indeterminate Stripe 5xx and waits for verified webhook reconciliation', async () => {
    state.stripeFails = true;
    const response = await POST(request('request-failure'));
    expect(response.status).toBe(503);
    expect(state.audits.map(({ data }) => data.action)).toEqual([
      'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED',
      'PLATFORM_BILLING_TRIAL_CARD_CONSENT', 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED',
    ]);
    expect(state.audits.find(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_CONSENT')?.data.metadata)
      .toMatchObject({ status: 'REQUESTED', version: '2026-10-27-v1' });
    expect(stripeMocks.createSetup).toHaveBeenCalled();
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
    expect(state.stripeCalledInTransaction).toBe(false);

    const differentKey = await POST(request('request-failure-new-key'));
    expect(differentKey.status).toBe(503);
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);

    state.stripeFails = false;
    const retry = await POST(request('request-failure'));
    expect(retry.status).toBe(503);
    expect(await retry.json()).toMatchObject({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' });
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_CONSENT')).toHaveLength(1);
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED')).toHaveLength(0);

    state.audits.push({ id: 'verified-completion', data: {
      action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED', contaId: 'conta_a',
      billingAccountId: 'billing_a', entityId: 'cs_reconciled', correlationId: 'request-failure',
    } });
    const reconciledRetry = await POST(request('request-failure'));
    expect(reconciledRetry.status).toBe(200);
    expect(await reconciledRetry.json()).toEqual({ setupCompleted: true });
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
  });

  it('does not report an expired same-key attempt as indeterminate after verified expiration', async () => {
    state.audits = [
      { id: 'expired-claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'expired-key', correlationId: 'expired-key' } },
      { id: 'expired-consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'expired-key', correlationId: 'expired-key',
        metadata: { status: 'REQUESTED', version: '2026-10-27-v1', acceptedAt: '2026-10-27T12:00:00.000Z' } } },
      { id: 'expired-failure', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'expired-key', correlationId: 'expired-key' } },
      { id: 'expired-resolution', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'cs_expired', correlationId: 'expired-key' } },
    ];

    const response = await POST(request('expired-key'));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PLATFORM_BILLING_SETUP_SESSION_EXPIRED_NEW_KEY_REQUIRED' });
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('retrieves a known locally expired session immediately and records canonical expiration for a same-key retry', async () => {
    const requestKey = 'known-expired-same-key';
    const acceptedAt = '2026-10-27T12:00:00.000Z';
    const metadata = { contaId: 'conta_a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: requestKey, consentVersion: '2026-10-27-v1', consentAcceptedAt: acceptedAt };
    const expiredSession = { id: 'cs_known_expired', mode: 'setup', status: 'expired', customer: 'cus_a',
      client_reference_id: 'conta_a', metadata };
    state.audits = [
      { id: 'claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, createdAt: new Date() } },
      { id: 'consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, metadata: { status: 'REQUESTED', version: metadata.consentVersion, acceptedAt } } },
      { id: 'session', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: expiredSession.id, correlationId: requestKey, metadata: { sessionId: expiredSession.id,
          setupUrl: 'https://stripe.test/expired', expiresAt: new Date(Date.now() - 60_000).toISOString() } } },
    ];
    state.retrievedSession = expiredSession;

    const response = await POST(request(requestKey));

    expect(stripeMocks.listSessions).not.toHaveBeenCalled();
    expect(stripeMocks.retrieveSession).toHaveBeenCalledWith(expect.anything(), expiredSession.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PLATFORM_BILLING_SETUP_SESSION_EXPIRED_NEW_KEY_REQUIRED' });
    expect(state.audits.some(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED'
      && data.entityId === expiredSession.id && data.correlationId === requestKey
      && data.webhookEnvironment === 'TEST')).toBe(true);
    expect(state.advisoryKeys).toContain(`trial-card-terminal:TEST:conta_a:${expiredSession.id}`);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('does not return a locally expired URL or release another-key claim while canonical Stripe status is still open', async () => {
    const requestKey = 'known-open-webhook-delayed';
    const acceptedAt = '2026-10-27T12:00:00.000Z';
    const metadata = { contaId: 'conta_a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: requestKey, consentVersion: '2026-10-27-v1', consentAcceptedAt: acceptedAt };
    const openSession = { id: 'cs_known_open', mode: 'setup', status: 'open', customer: 'cus_a',
      client_reference_id: 'conta_a', metadata };
    state.audits = [
      { id: 'claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, createdAt: new Date() } },
      { id: 'consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, metadata: { status: 'REQUESTED', version: metadata.consentVersion, acceptedAt } } },
      { id: 'session', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: openSession.id, correlationId: requestKey, metadata: { sessionId: openSession.id,
          setupUrl: 'https://stripe.test/expired-locally', expiresAt: new Date(Date.now() - 60_000).toISOString() } } },
    ];
    state.retrievedSession = openSession;

    const sameKey = await POST(request(requestKey));
    expect(sameKey.status).toBe(503);
    const sameKeyBody = await sameKey.json();
    expect(sameKeyBody).toMatchObject({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' });
    expect(JSON.stringify(sameKeyBody)).not.toContain('https://stripe.test/expired-locally');

    const anotherKey = await POST(request('another-key-while-open'));
    expect(anotherKey.status).toBe(503);
    expect(await anotherKey.json()).toMatchObject({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' });
    expect(state.audits.some(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED')).toBe(false);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('recovers a known locally expired session immediately when canonical Stripe status is complete', async () => {
    const requestKey = 'known-complete-same-key';
    const acceptedAt = '2026-10-27T12:00:00.000Z';
    const metadata = { contaId: 'conta_a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: requestKey, consentVersion: '2026-10-27-v1', consentAcceptedAt: acceptedAt };
    const completeSession = { id: 'cs_known_complete', mode: 'setup', status: 'complete', customer: 'cus_a',
      client_reference_id: 'conta_a', metadata, setup_intent: 'seti_known_complete' };
    state.audits = [
      { id: 'claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, createdAt: new Date() } },
      { id: 'consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: requestKey, correlationId: requestKey, metadata: { status: 'REQUESTED', version: metadata.consentVersion, acceptedAt } } },
      { id: 'session', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: completeSession.id, correlationId: requestKey, metadata: { sessionId: completeSession.id,
          setupUrl: 'https://stripe.test/locally-expired', expiresAt: new Date(Date.now() - 60_000).toISOString() } } },
    ];
    state.retrievedSession = completeSession;
    state.retrievedSetupIntent = { id: 'seti_known_complete', status: 'succeeded', customer: 'cus_a', metadata,
      payment_method: { id: 'pm_known_complete', object: 'payment_method', type: 'card', customer: 'cus_a',
        card: { brand: 'visa', last4: '4242', exp_month: 6, exp_year: 2028 } } };

    const response = await POST(request(requestKey));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ setupCompleted: true });
    expect(stripeMocks.listSessions).not.toHaveBeenCalled();
    expect(stripeMocks.allowRedisplay).toHaveBeenCalledWith(expect.anything(), 'pm_known_complete');
    expect(state.audits.find(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED')?.data)
      .toMatchObject({ webhookEventId: null, entityId: completeSession.id, correlationId: requestKey });
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('does not read or mutate tenant B setup claims when tenant A uses the same request key', async () => {
    state.audits = [{ id: 'tenant-b-claim', data: {
      action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_b',
      billingAccountId: 'billing_b', entityId: 'shared-request-key', correlationId: 'shared-request-key',
    } }];

    const response = await POST(request('shared-request-key'));

    expect(response.status).toBe(200);
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
    expect(state.audits.find(({ id }) => id === 'tenant-b-claim')?.data).toMatchObject({
      contaId: 'conta_b', billingAccountId: 'billing_b',
    });
    expect(state.audits.filter(({ data }) => data.contaId === 'conta_a')).toHaveLength(3);
    expect(state.audits.filter(({ data }) => data.contaId === 'conta_b')).toHaveLength(1);
  });

  it('releases an indeterminate claim only after a tenant-bound expiration webhook audit, even without a local session audit', async () => {
    state.audits = [
      { id: 'old-claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'old-key', correlationId: 'old-key', createdAt: new Date(Date.now() - 10_000) } },
      { id: 'expired', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'cs_unknown_local', correlationId: 'old-key' } },
    ];

    const response = await POST(request('new-key-after-expiration'));

    expect(response.status).toBe(200);
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
    expect(state.audits.find(({ id }) => id === 'expired')?.data).toMatchObject({ contaId: 'conta_a', billingAccountId: 'billing_a' });
    expect(state.audits.find(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED')?.data.contaId).toBe('conta_a');
  });

  it('reconciles an old ambiguous 5xx from a complete customer session listing before allowing a new key', async () => {
    const createdAt = new Date(Date.now() - 27 * 60 * 60_000);
    const oldKey = 'old-indeterminate';
    const metadata = { contaId: 'conta_a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: oldKey, consentVersion: '2026-10-27-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    state.audits = [
      { id: 'old-claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey, createdAt } },
      { id: 'old-consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey, metadata: { status: 'REQUESTED', version: metadata.consentVersion, acceptedAt: metadata.consentAcceptedAt } } },
      { id: 'old-failure', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey, metadata: { outcome: 'INDETERMINATE' } } },
    ];
    const remoteSession = { id: 'cs_expired_remote', mode: 'setup', status: 'expired', customer: 'cus_a',
      client_reference_id: 'conta_a', metadata, expires_at: Math.floor(Date.now() / 1000) - 10 };
    state.listedSessions = [remoteSession];
    state.retrievedSession = remoteSession;

    const response = await POST(request('new-key-after-reconcile'));

    expect(response.status).toBe(200);
    expect(stripeMocks.listSessions).toHaveBeenCalledWith(expect.anything(), 'cus_a', expect.any(Date));
    expect(stripeMocks.retrieveSession).toHaveBeenCalledWith(expect.anything(), 'cs_expired_remote');
    expect(state.audits.some(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED'
      && data.contaId === 'conta_a' && data.correlationId === oldKey)).toBe(true);
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
  });

  it('records a completed remote session without a local session audit and reuses that completion on retry', async () => {
    const createdAt = new Date(Date.now() - 27 * 60 * 60_000);
    const oldKey = 'old-completed-no-local-session';
    const metadata = { contaId: 'conta_a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: oldKey, consentVersion: '2026-10-27-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    state.audits = [
      { id: 'old-claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey, createdAt } },
      { id: 'old-consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey, metadata: { status: 'REQUESTED', version: metadata.consentVersion, acceptedAt: metadata.consentAcceptedAt } } },
      { id: 'old-failure', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED', contaId: 'conta_a', billingAccountId: 'billing_a',
        entityId: oldKey, correlationId: oldKey } },
    ];
    const remoteSession = { id: 'cs_completed_remote', mode: 'setup', status: 'complete', customer: 'cus_a',
      client_reference_id: 'conta_a', metadata, setup_intent: 'seti_remote' };
    state.listedSessions = [remoteSession];
    state.retrievedSession = remoteSession;
    state.retrievedSetupIntent = { id: 'seti_remote', status: 'succeeded', customer: 'cus_a', metadata,
      payment_method: { id: 'pm_remote', object: 'payment_method', type: 'card', customer: 'cus_a',
        card: { brand: 'visa', last4: '4242', exp_month: 6, exp_year: 2028 } } };

    const response = await POST(request(oldKey));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ setupCompleted: true });
    expect(stripeMocks.allowRedisplay).toHaveBeenCalledWith(expect.anything(), 'pm_remote');
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED')).toHaveLength(1);
    expect(state.audits.find(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED')?.data)
      .toMatchObject({ webhookEventId: null, correlationId: oldKey, entityId: 'cs_completed_remote' });
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('unblocks no-session ambiguity only after a complete aged listing; incomplete listings remain blocked', async () => {
    const createdAt = new Date(Date.now() - 27 * 60 * 60_000);
    const oldKey = 'old-no-session';
    state.audits = [
      { id: 'old-claim', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a', billingAccountId: 'billing_a', entityId: oldKey, correlationId: oldKey, createdAt } },
      { id: 'old-consent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta_a', billingAccountId: 'billing_a', entityId: oldKey, correlationId: oldKey, metadata: { status: 'REQUESTED', version: '2026-10-27-v1', acceptedAt: '2026-10-27T12:00:00.000Z' } } },
      { id: 'old-failure', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED', contaId: 'conta_a', billingAccountId: 'billing_a', entityId: oldKey, correlationId: oldKey } },
    ];
    state.listingComplete = false;
    const blocked = await POST(request('new-key-incomplete-list'));
    expect(blocked.status).toBe(503);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();

    state.listingComplete = true;
    const recovered = await POST(request('new-key-no-session'));
    expect(recovered.status).toBe(200);
    expect(state.audits.some(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_NO_SESSION_CONFIRMED'
      && data.contaId === 'conta_a' && data.correlationId === oldKey)).toBe(true);
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
  });

  it('reuses the same completed session by tenant-scoped idempotency key under concurrent retries', async () => {
    const [first, second] = await Promise.all([
      POST(request('request-concurrent')),
      POST(request('request-concurrent')),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stripeMocks.createSetup).toHaveBeenCalled();
    expect(new Set(stripeMocks.createSetup.mock.calls.map(([, input]) => input.idempotencyKey)).size).toBe(1);
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_CONSENT')).toHaveLength(1);
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED')).toHaveLength(1);
  });

  it('serializes different idempotency keys while an optional setup session is being created', async () => {
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let release!: () => void;
    state.stripeGate = new Promise<void>((resolve) => { release = resolve; });
    state.stripeStarted = signalStarted;

    const firstPromise = POST(request('request-open-one'));
    const secondPromise = POST(request('request-open-two'));
    await started;
    const second = await secondPromise;
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'PLATFORM_BILLING_SETUP_CHECKOUT_ALREADY_OPEN' });
    expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
    expect(state.advisoryKeys.filter((key) => key === 'trial-card:TEST:billing_a')).toHaveLength(2);

    release();
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(state.audits.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED')).toHaveLength(1);
  });

  it('rejects a different key while a prior Setup Checkout session is still open', async () => {
    state.audits = [
      { id: 'claim_1', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'open-key', correlationId: 'open-key' } },
      { id: 'session_1', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta_a',
        billingAccountId: 'billing_a', entityId: 'cs_open', correlationId: 'open-key',
        metadata: { sessionId: 'cs_open', setupUrl: 'https://stripe.test/open', expiresAt: new Date(Date.now() + 60_000).toISOString() } } },
    ];

    const response = await POST(request('new-key'));
    expect(response.status).toBe(409);
    expect(stripeMocks.createSetup).not.toHaveBeenCalled();
  });

  it('allows a new setup key after the prior session expired or completed', async () => {
    for (const stateKind of ['expired', 'completed'] as const) {
      state.audits = [
        { id: `claim_${stateKind}`, data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta_a',
          billingAccountId: 'billing_a', entityId: `old-${stateKind}`, correlationId: `old-${stateKind}` } },
        { id: `session_${stateKind}`, data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta_a',
          billingAccountId: 'billing_a', entityId: `cs_${stateKind}`, correlationId: `old-${stateKind}`,
          metadata: { sessionId: `cs_${stateKind}`, setupUrl: 'https://stripe.test/old',
            expiresAt: stateKind === 'expired' ? new Date(Date.now() - 60_000).toISOString() : new Date(Date.now() + 60_000).toISOString() } } },
        ...(stateKind === 'completed'
          ? [{ id: 'complete_1', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED', contaId: 'conta_a', billingAccountId: 'billing_a', entityId: 'cs_completed' } }]
          : [{ id: 'expired_1', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED', contaId: 'conta_a', billingAccountId: 'billing_a',
            entityId: `cs_${stateKind}`, correlationId: `old-${stateKind}` } }]),
      ];
      const response = await POST(request(`new-${stateKind}-key`));
      expect(response.status).toBe(200);
      expect(stripeMocks.createSetup).toHaveBeenCalledTimes(1);
      state.audits = [];
      stripeMocks.createSetup.mockClear();
    }
  });
});
