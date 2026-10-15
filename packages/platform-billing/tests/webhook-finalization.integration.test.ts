import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaPlatformBillingStore } from '../src';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')
  : '';
const isTestDatabase = databaseName === 'alusa_test';
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!isTestDatabase)('platform billing webhook finalization transaction', () => {
  it('prevents an older concurrent event from overwriting a newer committed account state', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `billing_webhook_order_${suffix}`;
    const billingAccountId = `pba_${suffix}`;
    const stripeSubscriptionId = `sub_order_${suffix}`;
    const initialProviderAt = new Date('2026-10-12T00:00:10.000Z');
    const newerProviderAt = new Date('2026-10-12T00:00:30.000Z');
    let reads = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    let releaseOlderWrite!: () => void;
    const newerCommitted = new Promise<void>((resolve) => { releaseOlderWrite = resolve; });
    const db = {
      $transaction: (callback: (_tx: unknown) => Promise<unknown>) => prisma.$transaction((tx) => {
        const accountDelegate = new Proxy(tx.platformBillingAccount, {
          get(target, property) {
            if (property === 'findUniqueOrThrow') {
              return async (args: unknown) => {
                const account = await target.findUniqueOrThrow(args as never);
                reads += 1;
                if (reads === 2) releaseReads();
                await bothRead;
                return account;
              };
            }
            if (property === 'updateMany') {
              return async (args: { data?: { lastStripeEventId?: string } }) => {
                if (args.data?.lastStripeEventId === 'evt_order_old') await newerCommitted;
                const result = await target.updateMany(args as never);
                if (args.data?.lastStripeEventId === 'evt_order_new' && result.count === 1) releaseOlderWrite();
                return result;
              };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const wrappedTx = new Proxy(tx, {
          get(target, property) {
            return property === 'platformBillingAccount'
              ? accountDelegate
              : Reflect.get(target, property, target);
          },
        });
        return callback(wrappedTx);
      }),
    };
    const store = createPrismaPlatformBillingStore(db as never);

    await prisma.conta.create({ data: { id: contaId, nome: 'Webhook ordering integration fixture' } });
    try {
      await prisma.platformBillingAccount.create({
        data: {
          id: billingAccountId, contaId, environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
          planCode: 'STARTER', stripeCustomerId: `cus_order_${suffix}`, stripeSubscriptionId,
          stripePriceId: 'price_starter_order', lastProviderEventCreatedAt: initialProviderAt,
          lastStripeEventId: 'evt_order_base',
        },
      });
      const expectedAccountSnapshot = {
        contaId, environment: 'TEST' as const, stripeSubscriptionId,
        pendingChangeOperationId: null, pendingChangeClaimToken: null,
        lastProviderEventCreatedAt: initialProviderAt, lastStripeEventId: 'evt_order_base',
      };
      const common = {
        accountId: billingAccountId, expectedAccountSnapshot,
        planCode: 'STARTER' as const, stripeSubscriptionId, stripePriceId: 'price_starter_order',
        currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      };
      const [newer, older] = await Promise.allSettled([
        store.updateAccountFromStripeSubscription({
          ...common, status: 'CANCELED', lastProviderEventCreatedAt: newerProviderAt, lastStripeEventId: 'evt_order_new',
        }),
        store.updateAccountFromStripeSubscription({
          ...common, status: 'PAST_DUE', lastProviderEventCreatedAt: new Date('2026-10-12T00:00:20.000Z'), lastStripeEventId: 'evt_order_old',
        }),
      ]);

      expect(newer.status).toBe('fulfilled');
      expect(older.status).toBe('rejected');
      expect(await prisma.platformBillingAccount.findUniqueOrThrow({ where: { id: billingAccountId } }))
        .toMatchObject({ status: 'CANCELED', lastStripeEventId: 'evt_order_new', lastProviderEventCreatedAt: newerProviderAt });
    } finally {
      await prisma.conta.delete({ where: { id: contaId } });
    }
  }, 30_000);

  it('rolls back account clear when the owned plan-change CAS fails, then recovers atomically', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `billing_webhook_atomic_${suffix}`;
    const billingAccountId = `pba_${suffix}`;
    const planChangeId = `pbc_${suffix}`;
    const stripeSubscriptionId = `sub_atomic_${suffix}`;
    const store = createPrismaPlatformBillingStore(prisma);
    const finalization = {
      planChangeId,
      contaId,
      billingAccountId,
      environment: 'TEST' as const,
      stripeSubscriptionId,
      stripePriceId: 'price_premium_atomic',
      toPlanCode: 'PREMIUM' as const,
      type: 'UPGRADE' as const,
      applied: true,
    };

    await prisma.conta.create({ data: { id: contaId, nome: 'Webhook atomic integration fixture' } });
    try {
      await prisma.platformBillingAccount.create({
        data: {
          id: billingAccountId,
          contaId,
          environment: 'TEST',
          status: 'ACTIVE',
          accessStatus: 'ACTIVE',
          planCode: 'STARTER',
          stripeCustomerId: `cus_atomic_${suffix}`,
          stripeSubscriptionId,
          stripePriceId: 'price_starter_atomic',
          pendingPlanCode: 'PREMIUM',
          pendingChangeType: 'UPGRADE',
          pendingChangeOperationId: planChangeId,
        },
      });
      await prisma.platformBillingPlanChange.create({
        data: {
          id: planChangeId,
          contaId,
          billingAccountId,
          environment: 'TEST',
          type: 'UPGRADE',
          status: 'PENDING_PAYMENT',
          fromPlanCode: 'STARTER',
          toPlanCode: 'PREMIUM',
          stripeSubscriptionId,
          stripePriceId: 'price_wrong_atomic',
          idempotencyKey: `atomic-${suffix}`,
        },
      });

      const update = {
        accountId: billingAccountId,
        expectedAccountSnapshot: {
          contaId,
          environment: 'TEST' as const,
          stripeSubscriptionId,
          pendingChangeOperationId: planChangeId,
          pendingChangeClaimToken: null,
        },
        planChangeFinalization: finalization,
        status: 'ACTIVE' as const,
        planCode: 'PREMIUM' as const,
        stripeSubscriptionId,
        stripePriceId: 'price_premium_atomic',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
        pendingChangeOperationId: null,
        lastStripeEventId: `evt_atomic_${suffix}`,
      };

      await expect(store.updateAccountFromStripeSubscription(update)).rejects.toThrow(
        'Stripe plan-change operation could not be finalized',
      );
      expect(await prisma.platformBillingAccount.findUniqueOrThrow({ where: { id: billingAccountId } }))
        .toMatchObject({ planCode: 'STARTER', stripePriceId: 'price_starter_atomic', pendingPlanCode: 'PREMIUM', pendingChangeOperationId: planChangeId });
      expect(await prisma.platformBillingPlanChange.findUniqueOrThrow({ where: { id: planChangeId } }))
        .toMatchObject({ status: 'PENDING_PAYMENT', stripePriceId: 'price_wrong_atomic' });

      await prisma.platformBillingPlanChange.update({
        where: { id: planChangeId },
        data: { stripePriceId: 'price_premium_atomic' },
      });
      await store.updateAccountFromStripeSubscription(update);

      expect(await prisma.platformBillingAccount.findUniqueOrThrow({ where: { id: billingAccountId } }))
        .toMatchObject({ planCode: 'PREMIUM', stripePriceId: 'price_premium_atomic', pendingPlanCode: null, pendingChangeOperationId: null });
      expect(await prisma.platformBillingPlanChange.findUniqueOrThrow({ where: { id: planChangeId } }))
        .toMatchObject({ status: 'APPLIED', stripePriceId: 'price_premium_atomic' });
    } finally {
      await prisma.conta.delete({ where: { id: contaId } });
    }
  }, 30_000);
});
