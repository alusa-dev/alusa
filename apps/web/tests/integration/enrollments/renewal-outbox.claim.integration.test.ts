import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const isSafeTestDatabase = (() => {
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    const isPostgres = ['postgres:', 'postgresql:'].includes(databaseUrl.protocol.toLowerCase());
    const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, '')).toLowerCase();
    const isDisposableTestDatabase = databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_');
    return isPostgres && isLoopback && isDisposableTestDatabase;
  } catch {
    return false;
  }
})();
const prisma = isSafeTestDatabase ? new PrismaClient() : null;
let processRenewalOutbox: typeof import('@/src/server/enrollments/renewal-outbox.service')['processRenewalOutbox'] | undefined;

describe.skipIf(!isSafeTestDatabase)('renewal outbox PostgreSQL claim integration', () => {
  const db = prisma as PrismaClient;
  const suffix = randomUUID().replaceAll('-', '');
  const contaAId = `renewal_claim_a_${suffix}`;
  const contaBId = `renewal_claim_b_${suffix}`;
  const eventAId = `renewal_claim_event_a_${suffix}`;
  const eventBId = `renewal_claim_event_b_${suffix}`;
  const now = new Date();

  beforeAll(async () => {
    const renewalOutboxService = await import('@/src/server/enrollments/renewal-outbox.service');
    processRenewalOutbox = renewalOutboxService.processRenewalOutbox;

    await db.conta.createMany({
      data: [
        { id: contaAId, nome: `Renewal claim A ${suffix}` },
        { id: contaBId, nome: `Renewal claim B ${suffix}` },
      ],
    });
    await db.rematriculaOutbox.createMany({
      data: [
        {
          id: eventAId,
          contaId: contaAId,
          eventType: 'UNSUPPORTED_CLAIM_RACE_TEST',
          dedupeKey: `renewal-claim-a-${suffix}`,
          payload: { test: true },
          status: 'PENDING',
          availableAt: new Date(now.getTime() - 1_000),
        },
        {
          id: eventBId,
          contaId: contaBId,
          eventType: 'UNSUPPORTED_CLAIM_RACE_TEST',
          dedupeKey: `renewal-claim-b-${suffix}`,
          payload: { test: true },
          status: 'PENDING',
          availableAt: new Date(now.getTime() - 1_000),
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await db.rematriculaOutbox.deleteMany({
      where: { id: { in: [eventAId, eventBId] } },
    });
    await db.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    await db.$disconnect();
  });

  it('allows only one worker to claim a row and leaves the other tenant untouched', async () => {
    let findManyArrivals = 0;
    let releaseFindMany: (() => void) | undefined;
    const bothWorkersRead = new Promise<void>((resolve) => {
      releaseFindMany = resolve;
    });

    const makeWorkerPrisma = () => {
      const outbox = new Proxy(db.rematriculaOutbox, {
        get(target, property) {
          if (property === 'findMany') {
            return async (...args: Parameters<typeof target.findMany>) => {
              const rows = await target.findMany(...args);
              findManyArrivals += 1;
              if (findManyArrivals === 2) releaseFindMany?.();
              await bothWorkersRead;
              return rows;
            };
          }
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      return new Proxy(db, {
        get(target, property) {
          if (property === 'rematriculaOutbox') return outbox;
          const value = Reflect.get(target, property) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };

    const results = await Promise.all([
      processRenewalOutbox!({ contaId: contaAId, now }, { prisma: makeWorkerPrisma() as PrismaClient }),
      processRenewalOutbox!({ contaId: contaAId, now }, { prisma: makeWorkerPrisma() as PrismaClient }),
    ]);

    const workerResults = results.flat();
    expect(workerResults).toHaveLength(2);
    expect(workerResults.filter((result) => result.status === 'FAILED')).toHaveLength(1);
    expect(workerResults.filter((result) => result.status === 'SKIPPED')).toHaveLength(1);
    expect(workerResults.every((result) => result.eventId === eventAId)).toBe(true);

    const [eventA, eventB] = await Promise.all([
      db.rematriculaOutbox.findUnique({ where: { id: eventAId } }),
      db.rematriculaOutbox.findUnique({ where: { id: eventBId } }),
    ]);
    expect(eventA).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(eventB).toMatchObject({ status: 'PENDING', attempts: 0, contaId: contaBId });
  }, 30_000);
});
