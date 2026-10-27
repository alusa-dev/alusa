import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPrismaPlatformBillingStore, createPlatformBillingCheckoutSession } from '../src';
import type { PlatformBillingStripeGateway } from '../src';

const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : '';
const isTestDatabase = databaseName === 'alusa_test';
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!isTestDatabase)('platform billing checkout PostgreSQL contention', () => {
  it('runs two full checkout use cases against Prisma and only one reaches Stripe', async () => {
    const contaId = `checkout_race_${randomUUID().replaceAll('-', '')}`;
    const stripeCustomerId = `cus_checkout_race_${randomUUID().replaceAll('-', '')}`;
    await prisma.conta.create({ data: { id: contaId, nome: 'Checkout race integration fixture' } });

    try {
      await prisma.platformBillingAccount.create({
        data: {
          contaId,
          environment: 'TEST',
          status: 'NOT_STARTED',
          accessStatus: 'PENDING',
          stripeCustomerId,
        },
      });

      let releaseStripe!: () => void;
      const stripeGate = new Promise<void>((resolve) => { releaseStripe = resolve; });
      const createCheckoutSession = vi.fn(async () => {
        await stripeGate;
        return {
          id: `cs_checkout_race_${randomUUID().replaceAll('-', '')}`,
          url: 'https://checkout.stripe.test/session',
          expiresAt: new Date(Date.now() + 60 * 60_000),
        };
      });
      const stripeGateway = {
        createCustomer: vi.fn(async () => { throw new Error('fixture already has a customer'); }),
        listCustomerSubscriptions: vi.fn(async () => ({ subscriptions: [], complete: true })),
        createCheckoutSession,
      } as unknown as PlatformBillingStripeGateway;
      const store = createPrismaPlatformBillingStore(prisma);
      const common = {
        contaId,
        contaName: 'Checkout race integration fixture',
        planCode: 'BAND_001_025',
        successUrl: 'https://app.alusa.test/billing/success',
        cancelUrl: 'https://app.alusa.test/billing/cancel',
        envSource: {
          STRIPE_ENVIRONMENT: 'TEST',
          STRIPE_SECRET_KEY: 'sk_test_integration',
          STRIPE_PRICE_BAND_001_025_MONTHLY: 'price_band_001_025_test',
          STRIPE_PRICE_BAND_026_050_MONTHLY: 'price_band_026_050_test',
        },
      };

      const first = createPlatformBillingCheckoutSession(
        { ...common, idempotencyKey: 'checkout-race-a', cancelUrl: `${common.cancelUrl}?checkoutRequestKey=checkout-race-a` },
        { store, stripeGateway },
      );
      await vi.waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
      const second = createPlatformBillingCheckoutSession(
        { ...common, idempotencyKey: 'checkout-race-b', cancelUrl: `${common.cancelUrl}?checkoutRequestKey=checkout-race-b`, planCode: 'BAND_026_050' },
        { store, stripeGateway },
      );
      const secondResult = await Promise.allSettled([second]);
      releaseStripe();
      const [firstResult] = await Promise.allSettled([first]);

      expect(firstResult?.status).toBe('fulfilled');
      expect(secondResult[0]?.status).toBe('rejected');
      expect(createCheckoutSession).toHaveBeenCalledTimes(1);
      expect(await prisma.platformBillingCheckoutSession.count({ where: { contaId, environment: 'TEST' } })).toBe(1);
    } finally {
      await prisma.conta.delete({ where: { id: contaId } });
    }
  }, 30_000);
});
