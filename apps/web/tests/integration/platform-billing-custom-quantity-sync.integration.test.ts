import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const isSafeTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (name === 'alusa_test' || name.startsWith('alusa_test_'));
  } catch {
    return false;
  }
})();

const prisma = isSafeTestDatabase ? new PrismaClient() : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!isSafeTestDatabase)('custom subscription quantity sync PostgreSQL constraints', () => {
  it('persists pre-discovery states without an item ID and requires an item ID for success', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_qty_sync_${suffix}`;
    const periodStart = new Date('2026-10-01T00:00:00.000Z');
    const operationKey = `alusa-custom-qty-test-${suffix}`;

    await db.conta.create({ data: { id: contaId, nome: 'Custom quantity sync constraint fixture' } });

    try {
      const snapshot = await db.platformBillingMonthlySnapshot.create({
        data: {
          contaId,
          environment: 'TEST',
          periodStart,
          studentCount: 42,
          customQuantitySyncStatus: 'PENDING',
          customQuantitySyncRequestedQuantity: 42,
          customQuantitySyncOperationKey: operationKey,
          customQuantitySyncStripeSubscriptionId: `sub_${suffix}`,
          customQuantitySyncPriceId: `price_${suffix}`,
          customQuantitySyncAttemptCount: 0,
        },
      });
      expect(snapshot.customQuantitySyncStripeSubscriptionItemId).toBeNull();

      await db.platformBillingMonthlySnapshot.update({
        where: { id: snapshot.id },
        data: {
          customQuantitySyncStatus: 'UNKNOWN',
          customQuantitySyncAttemptCount: 1,
          customQuantitySyncLastAttemptAt: new Date(),
          customQuantitySyncLastErrorCode: 'STRIPE_REQUEST_UNKNOWN',
        },
      });

      const missingItemFailure = await db.platformBillingMonthlySnapshot.update({
        where: { id: snapshot.id },
        data: {
          customQuantitySyncStatus: 'SUCCEEDED',
          customQuantitySyncAppliedAt: new Date(),
        },
      }).then(() => null, (error: unknown) => error);
      expect(String(missingItemFailure)).toContain('violates check constraint');

      const succeeded = await db.platformBillingMonthlySnapshot.update({
        where: { id: snapshot.id },
        data: {
          customQuantitySyncStatus: 'SUCCEEDED',
          customQuantitySyncStripeSubscriptionItemId: `si_${suffix}`,
          customQuantitySyncAppliedAt: new Date(),
          customQuantitySyncLastErrorCode: null,
        },
      });
      expect(succeeded).toMatchObject({
        customQuantitySyncStatus: 'SUCCEEDED',
        customQuantitySyncStripeSubscriptionItemId: `si_${suffix}`,
      });

      const partialIdleFailure = await db.platformBillingMonthlySnapshot.create({
        data: {
          contaId,
          environment: 'TEST',
          periodStart: new Date('2026-11-01T00:00:00.000Z'),
          studentCount: 0,
          customQuantitySyncPriceId: `price_partial_${suffix}`,
        },
      }).then(() => null, (error: unknown) => error);
      expect(String(partialIdleFailure)).toContain('violates check constraint');
    } finally {
      await db.platformBillingMonthlySnapshot.deleteMany({ where: { contaId } });
      await db.conta.delete({ where: { id: contaId } });
    }
  }, 30_000);
});
