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

describe.skipIf(!isTestDatabase)('platform billing invoice PostgreSQL concurrency', () => {
  it('serializes Conta ownership and preserves PAID against a delayed failure event', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const contaA = `invoice_owner_a_${suffix}`;
    const contaB = `invoice_owner_b_${suffix}`;
    const stripeInvoiceId = `in_concurrent_${suffix}`;
    const store = createPrismaPlatformBillingStore(prisma);
    await prisma.conta.createMany({ data: [
      { id: contaA, nome: 'Invoice owner A fixture' },
      { id: contaB, nome: 'Invoice owner B fixture' },
    ] });

    const base = {
      environment: 'TEST' as const,
      stripeInvoiceId,
      stripeCustomerId: `cus_${suffix}`,
      stripeSubscriptionId: `sub_${suffix}`,
      stripePriceId: 'price_starter_test',
      planCode: 'STARTER' as const,
      amountDue: 1200,
      currency: 'brl',
      attempted: true,
      attemptCount: 1,
    };
    try {
      const ownershipResults = await Promise.allSettled([
        store.upsertInvoice({ ...base, contaId: contaA, status: 'OPEN', amountPaid: 0, lastStripeEventId: 'evt_owner_a' }),
        store.upsertInvoice({ ...base, contaId: contaB, status: 'OPEN', amountPaid: 0, lastStripeEventId: 'evt_owner_b' }),
      ]);
      expect(ownershipResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(ownershipResults.filter((result) => result.status === 'rejected')).toHaveLength(1);

      const invoice = await prisma.platformBillingInvoice.findUniqueOrThrow({
        where: { uq_platform_billing_invoice_env_invoice: { environment: 'TEST', stripeInvoiceId } },
      });
      const owner = invoice.contaId;
      expect([contaA, contaB]).toContain(owner);

      const paidAt = new Date('2026-10-12T12:00:00Z');
      await store.upsertInvoice({
        ...base, contaId: owner, status: 'PAID', amountPaid: 1200, paidAt,
        lastStripeEventId: 'evt_invoice_paid',
      });
      await store.upsertInvoice({
        ...base, contaId: owner, status: 'OPEN', amountPaid: 0,
        failedAt: new Date('2026-10-12T11:00:00Z'),
        nextPaymentAttempt: new Date('2026-10-13T00:00:00Z'),
        lastPaymentErrorCode: 'card_declined', lastPaymentErrorMessage: 'Delayed stale failure',
        lastStripeEventId: 'evt_invoice_old_failed',
      });

      const finalInvoice = await prisma.platformBillingInvoice.findUniqueOrThrow({
        where: { uq_platform_billing_invoice_env_invoice: { environment: 'TEST', stripeInvoiceId } },
      });
      expect(finalInvoice).toMatchObject({
        contaId: owner, status: 'PAID', amountPaid: 1200, paidAt,
        failedAt: null, nextPaymentAttempt: null,
        lastPaymentErrorCode: null, lastPaymentErrorMessage: null,
      });
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [contaA, contaB] } } });
    }
  }, 30_000);
});
