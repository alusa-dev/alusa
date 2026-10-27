import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, stripeMock } = vi.hoisted(() => {
  const setupAuditRows: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prismaMock = {
    platformBillingAccount: { findFirst: vi.fn(async ({ where }: { where: { contaId: string; stripeCustomerId?: string } }) =>
      where.contaId === 'conta-a' && (!where.stripeCustomerId || where.stripeCustomerId === 'cus-a')
        ? { id: 'billing-a' } : null) },
    platformBillingWebhookEvent: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    platformBillingAuditLog: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = setupAuditRows.find(({ data }) => Object.entries(where).every(([key, value]) => data[key] === value));
        return found?.data ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `audit-${setupAuditRows.length + 1}`, data };
        setupAuditRows.push(row);
        return { id: row.id };
      }),
      createMany: vi.fn(),
    },
    platformBillingNotificationOutbox: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    setupAuditRows,
    terminalLockKeys: [] as string[],
  };
  const stripeMock = {
    retrieveSession: vi.fn(),
    retrieveSetupIntent: vi.fn(),
    allowRedisplay: vi.fn(),
  };
  return { prismaMock, stripeMock };
});

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@alusa/stripe', () => ({
  getStripeClient: () => ({}),
  retrieveStripeSetupCheckoutSession: stripeMock.retrieveSession,
  retrieveStripeSetupIntent: stripeMock.retrieveSetupIntent,
  allowStripePaymentMethodRedisplay: stripeMock.allowRedisplay,
  retrieveStripeInvoiceEventObject: vi.fn(async (_client: unknown, id: string) => ({ id })),
  retrieveStripeSubscriptionEventObject: vi.fn(async (_client: unknown, id: string) => ({ id })),
}));
vi.mock('@/lib/prisma-tenant', () => {
  const queues = new Map<string, Promise<void>>();
  return { runWithTenant: async (_contaId: string, callback: (tx: unknown) => Promise<unknown>) => {
    const releases: Array<() => void> = [];
    const tx = Object.assign({}, prismaMock, {
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const key = String(values[0] ?? 'missing-advisory-key');
        prismaMock.terminalLockKeys.push(key);
        const previous = queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const queued = previous.then(() => held);
        queues.set(key, queued);
        await previous;
        releases.push(() => { release(); if (queues.get(key) === queued) queues.delete(key); });
        return [];
      },
    });
    try { return await callback(tx); } finally { for (const release of releases.reverse()) release(); }
  } };
});
vi.mock('@alusa/platform-billing', () => ({
  PlatformBillingError: class PlatformBillingError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(message: string, code: string, details?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  classifyPlatformBillingWebhookError: vi.fn(),
  computePlatformBillingWebhookNextAttemptAt: vi.fn(),
  hasExhaustedPlatformBillingWebhookAttempts: vi.fn(() => false),
  createPrismaPlatformBillingStore: vi.fn(),
  processPersistedPlatformBillingWebhookEvent: vi.fn(),
}));
vi.mock('./platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('./platform-billing-notifications', () => ({
  notifyPlatformBillingEvent: vi.fn(),
}));

import { drainPlatformBillingNotificationOutbox, drainStripeWebhookWorker, listPlatformBillingNotificationOutbox, listStripeWebhookEvents, replayPlatformBillingNotifications, replayStripeWebhookEvents, resolveCanonicalNotificationEventType } from './webhook-worker';
import { notifyPlatformBillingEvent } from './platform-billing-notifications';
import { classifyPlatformBillingWebhookError, createPrismaPlatformBillingStore, PlatformBillingError, processPersistedPlatformBillingWebhookEvent } from '@alusa/platform-billing';

describe('platform billing webhook worker persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.setupAuditRows.length = 0;
    prismaMock.terminalLockKeys.length = 0;
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.platformBillingWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingAuditLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `audit-${prismaMock.setupAuditRows.length + 1}`, data };
      prismaMock.setupAuditRows.push(row);
      return { id: row.id };
    });
    prismaMock.platformBillingAuditLog.createMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingNotificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: unknown) => unknown) => callback(prismaMock));
    stripeMock.retrieveSession.mockReset();
    stripeMock.retrieveSetupIntent.mockReset();
    stripeMock.allowRedisplay.mockReset();
  });

  it('does not notify a stale payment failure after canonical invoice retrieval confirms payment', () => {
    const canonicalEvent = {
      id: 'evt-old-failure', type: 'invoice.payment_failed',
      data: { object: { id: 'in-1', status: 'paid' } },
    } as never;
    expect(resolveCanonicalNotificationEventType('invoice.payment_failed', canonicalEvent)).toBe('invoice.paid');
    expect(resolveCanonicalNotificationEventType('invoice.payment_failed', {
      id: 'evt-old-failure', type: 'invoice.payment_failed',
      data: { object: { id: 'in-1', status: 'open' } },
    } as never)).toBe('invoice.payment_failed');
  });

  it('lista apenas eventos do tenant autenticado', async () => {
    await listStripeWebhookEvents({
      contaId: 'conta-a',
      environment: 'TEST',
      status: ['FAILED', 'EXHAUSTED'],
      limit: 25,
    });

    expect(prismaMock.platformBillingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        environment: 'TEST',
        status: { in: ['FAILED', 'EXHAUSTED'] },
      },
      take: 25,
    }));
  });

  it('restringe todas as mutações de replay a tenant ao receber IDs mistos e preserva auditoria', async () => {
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([
      { id: 'event-a', contaId: 'conta-a', eventId: 'stripe-event-a', eventType: 'invoice.paid' },
    ]);

    await replayStripeWebhookEvents({
      ids: ['event-a', 'event-b'],
      contaId: 'conta-a',
      actorUserId: 'user-a',
      reason: 'Retry operacional autorizado',
      environment: 'TEST',
    });

    expect(prismaMock.platformBillingWebhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['event-a', 'event-b'] },
        contaId: 'conta-a',
        environment: 'TEST',
      }),
      data: expect.objectContaining({
        status: 'PENDING',
        nextAttemptAt: expect.any(Date),
      }),
    }));
    expect(prismaMock.platformBillingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['event-a', 'event-b'] }, contaId: 'conta-a', environment: 'TEST' }),
    }));
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta-a',
        actorUserId: 'user-a',
        action: 'PLATFORM_BILLING_WEBHOOK_REPLAY_REQUESTED',
      }),
    }));
  });

  it('lists notification failures tenant-scoped and provides audited replay for exhausted items', async () => {
    prismaMock.platformBillingNotificationOutbox.findMany.mockResolvedValue([]);
    prismaMock.platformBillingNotificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingNotificationOutbox.findMany.mockResolvedValue([
      { id: 'outbox-a', eventId: 'evt-a', eventType: 'invoice.paid' },
    ]);
    await listPlatformBillingNotificationOutbox({ contaId: 'conta-a', environment: 'TEST', limit: 20 });
    await replayPlatformBillingNotifications({
      ids: ['outbox-a', 'outbox-b'], contaId: 'conta-a', actorUserId: 'user-a',
      reason: 'Retentativa após análise operacional', environment: 'TEST',
    });
    expect(prismaMock.platformBillingNotificationOutbox.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { contaId: 'conta-a', environment: 'TEST', status: { in: ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'] } },
    }));
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['outbox-a', 'outbox-b'] }, contaId: 'conta-a', environment: 'TEST', status: 'EXHAUSTED' },
      data: expect.objectContaining({ status: 'PENDING', attempts: 0 }),
    }));
    expect(prismaMock.platformBillingAuditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ contaId: 'conta-a', actorUserId: 'user-a', action: 'PLATFORM_BILLING_NOTIFICATION_REPLAY_REQUESTED' })],
    }));
  });

  it('marks the final failed notification attempt exhausted and stops automatic retries', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{
      id: 'outbox-exhausted', eventId: 'evt_exhausted', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 8,
    }]);
    vi.mocked(notifyPlatformBillingEvent).mockRejectedValueOnce(new Error('delivery failed'));
    const result = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-final' });
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 0, exhausted: 1 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'outbox-exhausted', status: 'PROCESSING', workerId: 'notify-final' },
      data: expect.objectContaining({ status: 'EXHAUSTED', lastError: 'delivery failed' }),
    }));
  });

  it('entrega notificações pelo outbox independente da inbox e cerca a confirmação pelo worker', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{
      id: 'outbox-1', eventId: 'evt_1', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1,
    }]);
    const result = await drainPlatformBillingNotificationOutbox({
      environment: 'TEST', workerId: 'notification-worker-a',
    });
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, exhausted: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'outbox-1', status: 'PROCESSING', workerId: 'notification-worker-a' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
  });

  it('retries a failed partial notification delivery with the same event idempotency identity', async () => {
    const record = { id: 'outbox-retry', eventId: 'evt_retry', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1 };
    prismaMock.$queryRaw.mockResolvedValueOnce([record]).mockResolvedValueOnce([{ ...record, attempts: 2 }]);
    vi.mocked(notifyPlatformBillingEvent)
      .mockRejectedValueOnce(new Error('email failed after inbox notification was persisted'))
      .mockResolvedValueOnce(undefined);
    const first = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-a' });
    const second = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-b' });
    expect(first).toMatchObject({ claimed: 1, delivered: 0, failed: 1 });
    expect(second).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'outbox-retry', status: 'PROCESSING', workerId: 'notify-a' },
      data: expect.objectContaining({ status: 'FAILED', lastError: expect.stringContaining('email failed') }),
    }));
    expect(vi.mocked(notifyPlatformBillingEvent).mock.calls.map(([input]) => [input.contaId, input.eventId, input.eventType]))
      .toEqual([['conta-a', 'evt_retry', 'invoice.payment_failed'], ['conta-a', 'evt_retry', 'invoice.payment_failed']]);
    expect(prismaMock.$queryRaw.mock.calls[1]?.[0]?.join('')).toContain(
      '"nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')',
    );
  });

  it('does not let an expired worker lease confirm delivery after another claimant takes over', async () => {
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const item = { id: 'outbox-race', eventId: 'evt_race', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1 };
    prismaMock.$queryRaw.mockResolvedValueOnce([item]).mockResolvedValueOnce([{ ...item, attempts: 2 }]);
    vi.mocked(notifyPlatformBillingEvent)
      .mockImplementationOnce(async () => deliveryGate)
      .mockResolvedValueOnce(undefined);
    prismaMock.platformBillingNotificationOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const firstPromise = drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-stale' });
    await vi.waitFor(() => expect(notifyPlatformBillingEvent).toHaveBeenCalledTimes(1));
    const second = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-current' });
    releaseDelivery();
    const first = await firstPromise;
    expect(second).toMatchObject({ claimed: 1, delivered: 1 });
    expect(first).toMatchObject({ claimed: 1, delivered: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'outbox-race', status: 'PROCESSING', workerId: 'notify-current' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'outbox-race', status: 'PROCESSING', workerId: 'notify-stale' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
  });

  it('exhausts a permanent webhook error on the first worker attempt', async () => {
    const event = {
      id: 'inbox-permanent', eventId: 'evt_permanent', eventType: 'invoice.paid',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt_permanent', type: 'invoice.paid', data: { object: {} } },
    };
    prismaMock.$queryRaw.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
    const permanentError = Object.assign(new PlatformBillingError('Unknown Stripe price.', 'PLATFORM_PRICE_UNKNOWN'), { code: 'PLATFORM_PRICE_UNKNOWN' });
    vi.mocked(processPersistedPlatformBillingWebhookEvent).mockRejectedValueOnce(permanentError);
    vi.mocked(classifyPlatformBillingWebhookError).mockReturnValueOnce('PERMANENT');
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({
      markWebhookEventFailed: vi.fn().mockResolvedValue(undefined),
      markWebhookEventProcessed: vi.fn(),
    } as never);

    const result = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'worker-permanent' });
    expect(result).toMatchObject({ claimed: 1, exhausted: 1, failed: 0 });
    expect(classifyPlatformBillingWebhookError).toHaveBeenCalledWith(permanentError);
    expect(vi.mocked(createPrismaPlatformBillingStore).mock.results.at(-1)?.value.markWebhookEventFailed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inbox-permanent', errorCode: 'PLATFORM_PRICE_UNKNOWN', exhausted: true, nextAttemptAt: undefined,
    }));
  });

  it('stores a safe stable code for a nested account snapshot contention cause', async () => {
    const event = {
      id: 'inbox-cas', eventId: 'evt_cas', eventType: 'customer.subscription.created',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt_cas', type: 'customer.subscription.created', data: { object: {} } },
    };
    prismaMock.$queryRaw.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
    const failure = new PlatformBillingError('Platform billing webhook processing failed.', 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED', {
      cause: 'Stripe account snapshot changed before subscription state could be applied.',
    });
    vi.mocked(processPersistedPlatformBillingWebhookEvent).mockRejectedValueOnce(failure);
    vi.mocked(classifyPlatformBillingWebhookError).mockReturnValueOnce('TEMPORARY');
    const markFailed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({
      markWebhookEventFailed: markFailed,
      markWebhookEventProcessed: vi.fn(),
    } as never);

    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'worker-cas' });

    expect(markFailed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inbox-cas', errorCode: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED',
      error: 'Platform billing webhook processing failed. [cause=ACCOUNT_SNAPSHOT_CAS_CONFLICT]',
      exhausted: false,
    }));
  });

  it('generates a distinct lease owner for every drain invocation by default', async () => {
    const first = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST' });
    const second = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST' });

    expect(first.workerId).toBeTruthy();
    expect(second.workerId).toBeTruthy();
    expect(second.workerId).not.toBe(first.workerId);
  });

  it('compares webhook retry timestamps in UTC with the database timestamp column', async () => {
    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'worker-utc' });

    const claimSql = prismaMock.$queryRaw.mock.calls[0]?.[0]?.join('');
    expect(claimSql).toContain('"nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
  });

  it('recovers expired Setup Checkout without a session audit and finalizes the inbox idempotently', async () => {
    const metadata = { contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: 'setup-expired-key', consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    const remoteSession = { id: 'cs_expired', mode: 'setup', status: 'expired', customer: 'cus-a',
      client_reference_id: 'conta-a', metadata };
    const inbox = { id: 'inbox-setup-expired', eventId: 'evt-setup-expired', eventType: 'checkout.session.expired',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt-setup-expired', type: 'checkout.session.expired', data: { object: remoteSession } } };
    prismaMock.setupAuditRows.push(
      { id: 'claim-a', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: 'setup-expired-key' } },
      { id: 'consent-a', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: 'setup-expired-key', metadata: { status: 'REQUESTED', version: 'consent-v1', acceptedAt: metadata.consentAcceptedAt } } },
    );
    prismaMock.$queryRaw.mockResolvedValueOnce([inbox]);
    stripeMock.retrieveSession.mockResolvedValue(remoteSession);
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({ markWebhookEventProcessed: markProcessed } as never);

    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'expired-setup-worker' });

    expect(prismaMock.setupAuditRows.some(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED'
      && data.entityId === 'cs_expired' && data.correlationId === 'setup-expired-key')).toBe(true);
    expect(prismaMock.setupAuditRows.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED')).toHaveLength(1);
    expect(markProcessed).toHaveBeenCalledWith({ id: 'inbox-setup-expired', contaId: 'conta-a', workerId: 'expired-setup-worker' });
    expect(processPersistedPlatformBillingWebhookEvent).not.toHaveBeenCalled();
  });

  it('deduplicates an expired webhook after local read-only reconciliation using environment scope', async () => {
    const requestKey = 'setup-local-expired-key';
    const metadata = { contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: requestKey, consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    const remoteSession = { id: 'cs_local_expired', mode: 'setup', status: 'expired', customer: 'cus-a',
      client_reference_id: 'conta-a', metadata };
    const inbox = { id: 'inbox-after-local-expiry', eventId: 'evt-after-local-expiry', eventType: 'checkout.session.expired',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt-after-local-expiry', type: 'checkout.session.expired', data: { object: remoteSession } } };
    prismaMock.setupAuditRows.push(
      { id: 'claim-local', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: requestKey } },
      { id: 'consent-local', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: requestKey, metadata: { status: 'REQUESTED', version: 'consent-v1', acceptedAt: metadata.consentAcceptedAt } } },
      { id: 'session-local', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: requestKey, entityId: 'cs_local_expired' } },
      { id: 'expired-local', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED', contaId: 'conta-a', billingAccountId: 'billing-a',
        webhookEnvironment: 'TEST', entityId: 'cs_local_expired', correlationId: requestKey, webhookEventId: null } },
    );
    prismaMock.$queryRaw.mockResolvedValueOnce([inbox]);
    stripeMock.retrieveSession.mockResolvedValue(remoteSession);
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({ markWebhookEventProcessed: markProcessed } as never);

    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'after-local-expiry-worker' });

    expect(prismaMock.setupAuditRows.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED'
      && data.entityId === 'cs_local_expired' && data.webhookEnvironment === 'TEST')).toHaveLength(1);
    expect(prismaMock.platformBillingAuditLog.create).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalledWith({ id: 'inbox-after-local-expiry', contaId: 'conta-a', workerId: 'after-local-expiry-worker' });
  });

  it('serializes concurrent expiration deliveries by environment, tenant, and session', async () => {
    const requestKey = 'setup-concurrent-expired-key';
    const metadata = { contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: requestKey, consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    const remoteSession = { id: 'cs_concurrent_expired', mode: 'setup', status: 'expired', customer: 'cus-a',
      client_reference_id: 'conta-a', metadata };
    const inboxA = { id: 'inbox-expired-a', eventId: 'evt-expired-a', eventType: 'checkout.session.expired',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt-expired-a', type: 'checkout.session.expired', data: { object: remoteSession } } };
    const inboxB = { ...inboxA, id: 'inbox-expired-b', eventId: 'evt-expired-b',
      payload: { id: 'evt-expired-b', type: 'checkout.session.expired', data: { object: remoteSession } } };
    prismaMock.setupAuditRows.push(
      { id: 'claim-concurrent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: requestKey } },
      { id: 'consent-concurrent', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: requestKey,
        metadata: { status: 'REQUESTED', version: 'consent-v1', acceptedAt: metadata.consentAcceptedAt } } },
    );
    prismaMock.$queryRaw.mockResolvedValueOnce([inboxA]).mockResolvedValueOnce([inboxB]);
    stripeMock.retrieveSession.mockResolvedValue(remoteSession);
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({ markWebhookEventProcessed: markProcessed } as never);

    await Promise.all([
      drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'expired-worker-a' }),
      drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'expired-worker-b' }),
    ]);

    expect(prismaMock.terminalLockKeys).toEqual([
      'trial-card-terminal:TEST:conta-a:cs_concurrent_expired',
      'trial-card-terminal:TEST:conta-a:cs_concurrent_expired',
    ]);
    expect(prismaMock.setupAuditRows.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED'
      && data.contaId === 'conta-a' && data.billingAccountId === 'billing-a'
      && data.webhookEnvironment === 'TEST' && data.entityId === 'cs_concurrent_expired')).toHaveLength(1);
    expect(markProcessed).toHaveBeenCalledTimes(2);
  });

  it('recovers completed Setup Checkout without a local session audit and treats duplicate webhook delivery idempotently', async () => {
    const metadata = { contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: 'setup-complete-key', consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    const remoteSession = { id: 'cs_completed', mode: 'setup', status: 'complete', customer: 'cus-a',
      client_reference_id: 'conta-a', metadata, setup_intent: 'seti-a' };
    const inbox = { id: 'inbox-setup-complete', eventId: 'evt-setup-complete', eventType: 'checkout.session.completed',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt-setup-complete', type: 'checkout.session.completed', data: { object: remoteSession } } };
    prismaMock.setupAuditRows.push(
      { id: 'claim-a', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: 'setup-complete-key' } },
      { id: 'consent-a', data: { action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', contaId: 'conta-a', billingAccountId: 'billing-a', correlationId: 'setup-complete-key', metadata: { status: 'REQUESTED', version: 'consent-v1', acceptedAt: metadata.consentAcceptedAt } } },
    );
    prismaMock.$queryRaw.mockResolvedValueOnce([inbox]);
    stripeMock.retrieveSession.mockResolvedValue(remoteSession);
    stripeMock.retrieveSetupIntent.mockResolvedValue({ id: 'seti-a', status: 'succeeded', customer: 'cus-a', metadata,
      payment_method: { id: 'pm-a', object: 'payment_method', type: 'card', customer: 'cus-a', card: { last4: '4242', brand: 'visa' } } });
    stripeMock.allowRedisplay.mockResolvedValue({ id: 'pm-a', allow_redisplay: 'always' });
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({ markWebhookEventProcessed: markProcessed } as never);

    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'complete-setup-worker' });
    prismaMock.$queryRaw.mockResolvedValueOnce([inbox]);
    await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'complete-setup-worker-retry' });

    expect(stripeMock.allowRedisplay).toHaveBeenCalledTimes(1);
    expect(prismaMock.setupAuditRows.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED')).toHaveLength(1);
    expect(prismaMock.setupAuditRows.find(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED')?.data)
      .toMatchObject({ webhookEventId: 'evt-setup-complete', entityId: 'cs_completed', correlationId: 'setup-complete-key' });
    expect(markProcessed).toHaveBeenCalledTimes(2);
  });

  it('ignores an out-of-order expiration event after canonical completion was already recorded', async () => {
    const metadata = { contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
      consentRequestKey: 'setup-order-key', consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z' };
    const eventSession = { id: 'cs_ordered', mode: 'setup', status: 'expired', customer: 'cus-a',
      client_reference_id: 'conta-a', metadata };
    const canonicalSession = { ...eventSession, status: 'complete' };
    const inbox = { id: 'inbox-expired-late', eventId: 'evt-expired-late', eventType: 'checkout.session.expired',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt-expired-late', type: 'checkout.session.expired', data: { object: eventSession } } };
    prismaMock.setupAuditRows.push({ id: 'completed-audit', data: {
      action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED', contaId: 'conta-a', billingAccountId: 'billing-a',
      webhookEnvironment: 'TEST', entityId: 'cs_ordered', correlationId: 'setup-order-key',
    } });
    prismaMock.$queryRaw.mockResolvedValueOnce([inbox]);
    stripeMock.retrieveSession.mockResolvedValue(canonicalSession);
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({ markWebhookEventProcessed: markProcessed } as never);

    const result = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'late-expiration-worker' });

    expect(result.ignored).toBe(1);
    expect(markProcessed).toHaveBeenCalledWith({ id: 'inbox-expired-late', contaId: 'conta-a', workerId: 'late-expiration-worker' });
    expect(prismaMock.setupAuditRows.filter(({ data }) => data.action === 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED')).toHaveLength(0);
  });
});
