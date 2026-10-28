import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaPlatformBillingStore, enqueuePlatformBillingWebhookEvent } from '@alusa/platform-billing';

const { stripeMocks, notifyMock } = vi.hoisted(() => ({
  stripeMocks: { getClient: vi.fn(), retrieveInvoice: vi.fn() },
  notifyMock: vi.fn(),
}));

vi.mock('@alusa/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/stripe')>();
  return {
    ...actual,
    getStripeClient: stripeMocks.getClient,
    retrieveStripeInvoiceEventObject: stripeMocks.retrieveInvoice,
  };
});
vi.mock('@/src/server/platform-billing/platform-billing-notifications', () => ({
  notifyPlatformBillingEvent: notifyMock,
}));

const isSafeTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    const isPostgres = ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase());
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const isDisposableTestDatabase = databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_');
    return isPostgres && isLoopback && isDisposableTestDatabase;
  } catch {
    return false;
  }
})();
const prisma = isSafeTestDatabase ? new PrismaClient() : null;
let drainStripeWebhookWorker: typeof import('@/src/server/platform-billing/webhook-worker')['drainStripeWebhookWorker'] | undefined;
let processStripeWebhookQueueMessage: typeof import('@/app/api/queues/platform-billing-stripe-webhooks/route')['processStripeWebhookQueueMessage'] | undefined;

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

describe.skipIf(!isSafeTestDatabase)('platform billing webhook worker PostgreSQL retry', () => {
  const database = prisma as PrismaClient;

  beforeAll(async () => {
    const webhookWorker = await import('@/src/server/platform-billing/webhook-worker');
    drainStripeWebhookWorker = webhookWorker.drainStripeWebhookWorker;
    const queueConsumer = await import('@/app/api/queues/platform-billing-stripe-webhooks/route');
    processStripeWebhookQueueMessage = queueConsumer.processStripeWebhookQueueMessage;
  });

  it('serializes competing inbox drains and recovers after financial writes but before outbox/finalization', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `billing_worker_retry_${suffix}`;
    const accountId = `pba_worker_${suffix}`;
    const eventId = `evt_worker_${suffix}`;
    const invoiceId = `in_worker_${suffix}`;
    const customerId = `cus_worker_${suffix}`;
    const subscriptionId = `sub_worker_${suffix}`;
    const priceId = 'price_worker_retry';
    const priorPrice = process.env.STRIPE_PRICE_STARTER_MONTHLY;
    const priorEnvironment = process.env.STRIPE_ENVIRONMENT;
    process.env.STRIPE_PRICE_STARTER_MONTHLY = priceId;
    process.env.STRIPE_ENVIRONMENT = 'TEST';

    const eventCreated = Math.floor(Date.now() / 1000);
    const payload = {
      id: eventId,
      object: 'event',
      type: 'invoice.paid',
      created: eventCreated,
      livemode: false,
      data: { object: { id: invoiceId, customer: customerId, subscription: subscriptionId, metadata: { contaId } } },
    };
    const canonicalInvoice = {
      id: invoiceId,
      customer: customerId,
      subscription: subscriptionId,
      status: 'paid',
      amount_due: 1500,
      amount_paid: 1500,
      currency: 'brl',
      number: `INV-${suffix}`,
      attempted: true,
      attempt_count: 1,
      created: eventCreated,
      status_transitions: { paid_at: eventCreated },
      metadata: { contaId },
      lines: { data: [{ pricing: { price_details: { price: priceId } } }] },
    };

    await database.conta.create({ data: { id: contaId, nome: 'Webhook worker integration fixture' } });
    try {
      await database.platformBillingAccount.create({
        data: {
          id: accountId,
          contaId,
          environment: 'TEST',
          status: 'ACTIVE',
          accessStatus: 'ACTIVE',
          planCode: 'STARTER',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          firstPaidAt: new Date(eventCreated * 1000 - 86_400_000),
          paymentMethodStatus: 'PRESENT',
        },
      });
      // Model a queue publish outage: use the production inbox enqueue path,
      // then leave the persisted event for the maintenance worker to recover.
      const enqueueResult = await enqueuePlatformBillingWebhookEvent(
        { event: payload as never, environment: 'TEST', envSource: process.env },
        createPrismaPlatformBillingStore(database),
      );
      expect(enqueueResult).toMatchObject({ status: 'queued', eventId, contaId });
      await database.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      expect(await database.platformBillingWebhookEvent.findUnique({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
      })).toMatchObject({ status: 'PENDING', environment: 'TEST', nextAttemptAt: expect.any(Date) });
      expect(await database.platformBillingWebhookEvent.count({
        where: { environment: 'TEST', status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      })).toBeGreaterThan(0);
      const rawEligible = await database.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PlatformBillingWebhookEvent"
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment"
          AND "eventId" = ${eventId}
          AND "status" IN ('PENDING', 'RECEIVED', 'FAILED')
          AND "nextAttemptAt" <= LOCALTIMESTAMP
      `;
      expect(rawEligible.map(({ id }) => id)).toEqual([(await database.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } }, select: { id: true },
      })).id]);

      let releaseFirstRetrieve!: () => void;
      const firstRetrieveGate = new Promise<void>((resolve) => { releaseFirstRetrieve = resolve; });
      let retrieveStarted!: () => void;
      const firstRetrieveStarted = new Promise<void>((resolve) => { retrieveStarted = resolve; });
      let releaseTakeoverRetrieve!: () => void;
      const takeoverRetrieveGate = new Promise<void>((resolve) => { releaseTakeoverRetrieve = resolve; });
      let takeoverRetrieveStarted!: () => void;
      const takeoverStarted = new Promise<void>((resolve) => { takeoverRetrieveStarted = resolve; });
      stripeMocks.getClient.mockReturnValue({});
      stripeMocks.retrieveInvoice
        .mockImplementationOnce(async () => {
          retrieveStarted();
          await firstRetrieveGate;
          return canonicalInvoice;
        })
        .mockImplementationOnce(async () => {
          takeoverRetrieveStarted();
          await takeoverRetrieveGate;
          return canonicalInvoice;
        })
        .mockResolvedValue(canonicalInvoice);
      notifyMock.mockResolvedValue(undefined);

      let failNextOutboxWrite = false;
      const outbox = new Proxy(database.platformBillingNotificationOutbox, {
        get(target, property) {
          if (property === 'upsert') {
            return async (args: Parameters<typeof target.upsert>[0]) => {
              if (failNextOutboxWrite) {
                failNextOutboxWrite = false;
                throw new Error('injected failure after financial mutation');
              }
              return target.upsert(args);
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const db = new Proxy(database, {
        get(target, property) {
          if (property === 'platformBillingNotificationOutbox') return outbox;
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      const scope = { environment: 'TEST' as const, eventIds: [eventId] };
      const emptyScope = await drainStripeWebhookWorker({ prisma: db, environment: 'TEST', eventIds: [] });
      expect(emptyScope.claimed).toBe(0);
      const firstDrain = drainStripeWebhookWorker({ prisma: db, ...scope });
      await Promise.race([
        firstRetrieveStarted,
        firstDrain.then(async (result) => {
          const row = await database.platformBillingWebhookEvent.findUnique({
            where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
          });
          throw new Error(`worker finished before Stripe retrieval: ${JSON.stringify({ result, row })}`);
        }),
      ]);
      const activeLease = await database.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
        select: { workerId: true, status: true, attempts: true },
      });
      const competingDrain = await drainStripeWebhookWorker({ prisma: db, ...scope });
      expect(competingDrain.claimed).toBe(0);
      expect(competingDrain.workerId).not.toBe(activeLease.workerId);
      expect(activeLease).toMatchObject({ status: 'PROCESSING', attempts: 1 });

      // Simultaneous at-least-once queue delivery must not contend against or
      // duplicate the mutation held by the maintenance worker's active lease.
      await expect(processStripeWebhookQueueMessage?.(
        { environment: 'TEST', eventId },
        {
          drain: ({ environment, eventIds }) => drainStripeWebhookWorker!({ prisma: db, environment, eventIds }),
          findStatus: async ({ environment, eventId: lookupEventId }) => {
            const current = await database.platformBillingWebhookEvent.findUnique({
              where: { uq_platform_billing_webhook_env_event: { environment, eventId: lookupEventId } },
              select: { status: true, nextAttemptAt: true, processingTimeoutAt: true },
            });
            return current;
          },
        },
      )).resolves.toBeUndefined();

      await database.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "processingTimeoutAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      const takeoverDrain = drainStripeWebhookWorker({ prisma: db, ...scope });
      await Promise.race([
        takeoverStarted,
        takeoverDrain.then(async (result) => {
          const row = await database.platformBillingWebhookEvent.findUnique({
            where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
          });
          throw new Error(`takeover worker finished before retrieval: ${JSON.stringify({ result, row })}`);
        }),
      ]);
      const takeoverLease = await database.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
        select: { workerId: true, status: true, attempts: true },
      });
      expect(takeoverLease.workerId).not.toBe(activeLease.workerId);
      expect(takeoverLease).toMatchObject({ status: 'PROCESSING', attempts: 2 });

      releaseFirstRetrieve();
      await expect(firstDrain).rejects.toThrow('Stripe webhook lease was lost before failure finalization.');
      expect(await database.platformBillingWebhookEvent.findUniqueOrThrow({ where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'PROCESSING', attempts: 2, workerId: takeoverLease.workerId });
      expect(await database.platformBillingInvoice.count({ where: { environment: 'TEST', stripeInvoiceId: invoiceId, contaId } })).toBe(1);
      expect(await database.platformBillingNotificationOutbox.count({ where: { environment: 'TEST', eventId } })).toBe(0);

      failNextOutboxWrite = true;
      releaseTakeoverRetrieve();
      const secondAttempt = await takeoverDrain;
      expect(secondAttempt).toMatchObject({ claimed: 1, processed: 1, failed: 1, exhausted: 0 });
      const takeoverEvent = await database.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
      });
      expect(takeoverEvent).toMatchObject({ status: 'FAILED', attempts: 2, lastError: 'injected failure after financial mutation' });

      await database.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      const retry = await drainStripeWebhookWorker({ prisma: db, ...scope });
      expect(retry).toMatchObject({ claimed: 1, processed: 1, failed: 0, exhausted: 0 });
      expect(retry.notifications).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });

      expect(await database.platformBillingWebhookEvent.findUniqueOrThrow({ where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'PROCESSED', attempts: 3, contaId });
      expect(await database.platformBillingInvoice.count({ where: { environment: 'TEST', stripeInvoiceId: invoiceId, contaId } })).toBe(1);
      expect(await database.platformBillingAuditLog.count({
        where: {
          contaId,
          webhookEnvironment: 'TEST',
          webhookEventId: eventId,
          action: 'PLATFORM_BILLING_INVOICE_PAID',
          entityType: 'StripeInvoice',
          entityId: invoiceId,
        },
      })).toBe(1);
      // Stripe event IDs are scoped by mode. A TEST/LIVE pair must not collide.
      await database.platformBillingAuditLog.createMany({
        data: [{
          contaId,
          billingAccountId: accountId,
          action: 'PLATFORM_BILLING_INVOICE_PAID',
          webhookEnvironment: 'LIVE',
          webhookEventId: eventId,
          entityType: 'StripeInvoice',
          entityId: invoiceId,
        }],
        skipDuplicates: true,
      });
      expect(await database.platformBillingAuditLog.count({
        where: { contaId, webhookEventId: eventId, action: 'PLATFORM_BILLING_INVOICE_PAID' },
      })).toBe(2);
      // Administrative audits omit webhook identity and remain append-only.
      await database.platformBillingAuditLog.createMany({
        data: [1, 2].map(() => ({
          contaId,
          billingAccountId: accountId,
          action: 'PLATFORM_BILLING_ADMIN_RECONCILED',
          entityType: 'PlatformBillingAccount',
          entityId: accountId,
        })),
        skipDuplicates: true,
      });
      expect(await database.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_ADMIN_RECONCILED', entityId: accountId },
      })).toBe(2);
      expect(await database.platformBillingNotificationOutbox.findUniqueOrThrow({ where: { uq_platform_billing_notification_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'DELIVERED', contaId });
      expect(await database.platformBillingAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .toMatchObject({ status: 'ACTIVE', lastStripeEventId: eventId, lastSuccessfulPaymentAt: new Date(eventCreated * 1000) });
    } finally {
      if (priorPrice === undefined) delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
      else process.env.STRIPE_PRICE_STARTER_MONTHLY = priorPrice;
      if (priorEnvironment === undefined) delete process.env.STRIPE_ENVIRONMENT;
      else process.env.STRIPE_ENVIRONMENT = priorEnvironment;
      await database.platformBillingNotificationOutbox.deleteMany({ where: { environment: 'TEST', eventId } });
      await database.platformBillingWebhookEvent.deleteMany({ where: { environment: 'TEST', eventId } });
      await database.conta.deleteMany({ where: { id: contaId } });
    }
  }, 30_000);
});
