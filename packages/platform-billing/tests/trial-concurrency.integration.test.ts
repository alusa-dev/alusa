import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPrismaPlatformBillingStore, createPlatformBillingTrialWithoutPaymentMethod } from '../src';
import type { PlatformBillingStripeGateway } from '../src';

const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : '';
const isTestDatabase = databaseName === 'alusa_test';
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!isTestDatabase)('platform billing trial PostgreSQL contention', () => {
  it('rejects a partial trial claim tuple whose CHECK expression would otherwise evaluate NULL', async () => {
    const contaId = `trial_partial_${randomUUID().replaceAll('-', '')}`;
    await prisma.conta.create({ data: { id: contaId, nome: 'Trial partial claim integration fixture' } });
    try {
      const rejection = await prisma.platformBillingAccount.create({
        data: {
          contaId,
          environment: 'TEST',
          status: 'NOT_STARTED',
          accessStatus: 'PENDING',
          trialSubscriptionClaimKey: 'orphan-key',
          trialSubscriptionClaimPhase: null,
          trialSubscriptionClaimedAt: null,
          trialSubscriptionRequestExpiresAt: null,
        },
      }).then(() => null, (error: unknown) => error as Error);
      expect(rejection).toBeInstanceOf(Error);
      expect(rejection?.message).toContain('PlatformBillingAccount_trialSubscriptionClaim_check');
      expect(await prisma.platformBillingAccount.count({ where: { contaId } })).toBe(0);
    } finally {
      await prisma.conta.delete({ where: { id: contaId } });
    }
  });

  it('lets one concurrent distinct-key trial request reach Stripe and converges one subscription', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `trial_race_${suffix}`;
    const stripeCustomerId = `cus_trial_race_${suffix}`;
    await prisma.conta.create({ data: { id: contaId, nome: 'Trial race integration fixture' } });

    try {
      let releaseStripe!: () => void;
      const stripeGate = new Promise<void>((resolve) => { releaseStripe = resolve; });
      const createTrialSubscriptionWithoutPaymentMethod = vi.fn(async () => {
        await stripeGate;
        return {
          id: `sub_trial_race_${suffix}`,
          customerId: stripeCustomerId,
          status: 'trialing' as const,
          priceId: 'price_starter_test',
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          cancelAtPeriodEnd: false,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          pendingUpdateId: null,
        };
      });
      const stripeGateway = {
        createCustomer: vi.fn(async () => ({ id: stripeCustomerId, livemode: false })),
        createTrialSubscriptionWithoutPaymentMethod,
      } as unknown as PlatformBillingStripeGateway;
      const store = createPrismaPlatformBillingStore(prisma);
      const common = {
        contaId,
        contaName: 'Trial race integration fixture',
        planCode: 'STARTER',
        envSource: {
          STRIPE_ENVIRONMENT: 'TEST',
          STRIPE_SECRET_KEY: 'sk_test_integration',
          STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
          STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
        },
      };

      const first = createPlatformBillingTrialWithoutPaymentMethod(
        { ...common, idempotencyKey: 'trial-race-a' },
        { store, stripeGateway },
      );
      await vi.waitFor(() => expect(createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledTimes(1));
      const second = await Promise.allSettled([
        createPlatformBillingTrialWithoutPaymentMethod(
          { ...common, idempotencyKey: 'trial-race-b', planCode: 'PREMIUM' },
          { store, stripeGateway },
        ),
      ]);
      releaseStripe();
      const firstResult = await Promise.allSettled([first]);

      expect(firstResult[0]?.status).toBe('fulfilled');
      expect(second[0]?.status).toBe('rejected');
      expect(createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledTimes(1);
      expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
      const account = await prisma.platformBillingAccount.findUniqueOrThrow({
        where: { uq_platform_billing_account_conta_env: { contaId, environment: 'TEST' } },
      });
      expect(account.stripeSubscriptionId).toBe(`sub_trial_race_${suffix}`);
      expect(account.trialSubscriptionClaimKey).toBeNull();
      expect(await prisma.platformBillingAccount.count({ where: { contaId, environment: 'TEST' } })).toBe(1);
    } finally {
      await prisma.conta.delete({ where: { id: contaId } });
    }
  }, 30_000);
});
