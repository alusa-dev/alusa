import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

import { drainPlatformBillingNotificationOutbox, drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')
  : '';
const isTestDatabase = databaseName === 'alusa_test';
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!isTestDatabase)('platform billing webhook worker PostgreSQL retry', () => {
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

    await prisma.conta.create({ data: { id: contaId, nome: 'Webhook worker integration fixture' } });
    try {
      await prisma.platformBillingAccount.create({
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
      await prisma.platformBillingWebhookEvent.create({
        data: {
          environment: 'TEST', eventId, eventType: 'invoice.paid', contaId,
          status: 'PENDING', attempts: 0, payload,
          nextAttemptAt: new Date(Date.now() - 1_000), correlationId: eventId,
        },
      });
      await prisma.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      expect(await prisma.platformBillingWebhookEvent.findUnique({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
      })).toMatchObject({ status: 'PENDING', environment: 'TEST', nextAttemptAt: expect.any(Date) });
      expect(await prisma.platformBillingWebhookEvent.count({
        where: { environment: 'TEST', status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      })).toBeGreaterThan(0);
      const rawEligible = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PlatformBillingWebhookEvent"
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment"
          AND "eventId" = ${eventId}
          AND "status" IN ('PENDING', 'RECEIVED', 'FAILED')
          AND "nextAttemptAt" <= LOCALTIMESTAMP
      `;
      expect(rawEligible.map(({ id }) => id)).toEqual([(await prisma.platformBillingWebhookEvent.findUniqueOrThrow({
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
      const outbox = new Proxy(prisma.platformBillingNotificationOutbox, {
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
      const db = new Proxy(prisma, {
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
          const row = await prisma.platformBillingWebhookEvent.findUnique({
            where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
          });
          throw new Error(`worker finished before Stripe retrieval: ${JSON.stringify({ result, row })}`);
        }),
      ]);
      const activeLease = await prisma.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
        select: { workerId: true, status: true, attempts: true },
      });
      const competingDrain = await drainStripeWebhookWorker({ prisma: db, ...scope });
      expect(competingDrain.claimed).toBe(0);
      expect(competingDrain.workerId).not.toBe(activeLease.workerId);
      expect(activeLease).toMatchObject({ status: 'PROCESSING', attempts: 1 });

      await prisma.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "processingTimeoutAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      const takeoverDrain = drainStripeWebhookWorker({ prisma: db, ...scope });
      await Promise.race([
        takeoverStarted,
        takeoverDrain.then(async (result) => {
          const row = await prisma.platformBillingWebhookEvent.findUnique({
            where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
          });
          throw new Error(`takeover worker finished before retrieval: ${JSON.stringify({ result, row })}`);
        }),
      ]);
      const takeoverLease = await prisma.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
        select: { workerId: true, status: true, attempts: true },
      });
      expect(takeoverLease.workerId).not.toBe(activeLease.workerId);
      expect(takeoverLease).toMatchObject({ status: 'PROCESSING', attempts: 2 });

      releaseFirstRetrieve();
      await expect(firstDrain).rejects.toThrow('Stripe webhook lease was lost before failure finalization.');
      expect(await prisma.platformBillingWebhookEvent.findUniqueOrThrow({ where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'PROCESSING', attempts: 2, workerId: takeoverLease.workerId });
      expect(await prisma.platformBillingInvoice.count({ where: { environment: 'TEST', stripeInvoiceId: invoiceId, contaId } })).toBe(1);
      expect(await prisma.platformBillingNotificationOutbox.count({ where: { environment: 'TEST', eventId } })).toBe(0);

      failNextOutboxWrite = true;
      releaseTakeoverRetrieve();
      const secondAttempt = await takeoverDrain;
      expect(secondAttempt).toMatchObject({ claimed: 1, processed: 1, failed: 1, exhausted: 0 });
      const takeoverEvent = await prisma.platformBillingWebhookEvent.findUniqueOrThrow({
        where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } },
      });
      expect(takeoverEvent).toMatchObject({ status: 'FAILED', attempts: 2, lastError: 'injected failure after financial mutation' });

      await prisma.$executeRaw`
        UPDATE "PlatformBillingWebhookEvent"
        SET "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      const retry = await drainStripeWebhookWorker({ prisma: db, ...scope });
      expect(retry).toMatchObject({ claimed: 1, processed: 1, failed: 0, exhausted: 0 });

      await prisma.$executeRaw`
        UPDATE "PlatformBillingNotificationOutbox"
        SET "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 second'
        WHERE "environment" = ${'TEST'}::"PlatformBillingEnvironment" AND "eventId" = ${eventId}
      `;
      const notificationDrain = await drainPlatformBillingNotificationOutbox({
        prisma: db, environment: 'TEST', workerId: `notify-${suffix}`, eventIds: [eventId],
      });
      expect(notificationDrain).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });

      expect(await prisma.platformBillingWebhookEvent.findUniqueOrThrow({ where: { uq_platform_billing_webhook_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'PROCESSED', attempts: 3, contaId });
      expect(await prisma.platformBillingInvoice.count({ where: { environment: 'TEST', stripeInvoiceId: invoiceId, contaId } })).toBe(1);
      expect(await prisma.platformBillingAuditLog.count({
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
      await prisma.platformBillingAuditLog.createMany({
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
      expect(await prisma.platformBillingAuditLog.count({
        where: { contaId, webhookEventId: eventId, action: 'PLATFORM_BILLING_INVOICE_PAID' },
      })).toBe(2);
      // Administrative audits omit webhook identity and remain append-only.
      await prisma.platformBillingAuditLog.createMany({
        data: [1, 2].map(() => ({
          contaId,
          billingAccountId: accountId,
          action: 'PLATFORM_BILLING_ADMIN_RECONCILED',
          entityType: 'PlatformBillingAccount',
          entityId: accountId,
        })),
        skipDuplicates: true,
      });
      expect(await prisma.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_ADMIN_RECONCILED', entityId: accountId },
      })).toBe(2);
      expect(await prisma.platformBillingNotificationOutbox.findUniqueOrThrow({ where: { uq_platform_billing_notification_env_event: { environment: 'TEST', eventId } } }))
        .toMatchObject({ status: 'DELIVERED', contaId });
      expect(await prisma.platformBillingAccount.findUniqueOrThrow({ where: { id: accountId } }))
        .toMatchObject({ status: 'ACTIVE', lastStripeEventId: eventId, lastSuccessfulPaymentAt: new Date(eventCreated * 1000) });
    } finally {
      if (priorPrice === undefined) delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
      else process.env.STRIPE_PRICE_STARTER_MONTHLY = priorPrice;
      if (priorEnvironment === undefined) delete process.env.STRIPE_ENVIRONMENT;
      else process.env.STRIPE_ENVIRONMENT = priorEnvironment;
      await prisma.platformBillingNotificationOutbox.deleteMany({ where: { environment: 'TEST', eventId } });
      await prisma.platformBillingWebhookEvent.deleteMany({ where: { environment: 'TEST', eventId } });
      await prisma.conta.deleteMany({ where: { id: contaId } });
    }
  }, 30_000);
});
