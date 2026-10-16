import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function isSafeLocalTestDatabase(): boolean {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && (databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_'));
  } catch {
    return false;
  }
}

const safeLocalTestDatabase = isSafeLocalTestDatabase();
const db = safeLocalTestDatabase ? new PrismaClient() : null;
let enqueueFamilyBillingOutbox: typeof import('./processor').enqueueFamilyBillingOutbox | undefined;

describe.skipIf(!safeLocalTestDatabase)('family billing outbox enqueue PostgreSQL integration', () => {
  const database = db as PrismaClient;
  const suffix = randomUUID();
  const contaAId = `family-outbox-a-${suffix}`;
  const contaBId = `family-outbox-b-${suffix}`;
  const aggregateId = `family-outbox-aggregate-${suffix}`;
  const dedupeKey = `MATRICULA_FAMILIAR:${aggregateId}:SYNC_FAMILY_BILLING`;

  beforeAll(async () => {
    const processor = await import('./processor');
    enqueueFamilyBillingOutbox = processor.enqueueFamilyBillingOutbox;

    await database.conta.createMany({
      data: [
        { id: contaAId, nome: `Family outbox A ${suffix}` },
        { id: contaBId, nome: `Family outbox B ${suffix}` },
      ],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.familyBillingOutbox.deleteMany({
      where: { contaId: { in: [contaAId, contaBId] }, dedupeKey },
    });
    await db.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    await db.$disconnect();
  });

  it('converges concurrent same-tenant enqueues while keeping an identical key separate across tenants', async () => {
    const payloadFor = (contaId: string) => ({
      aggregateType: 'MATRICULA_FAMILIAR' as const,
      aggregateId,
      contaId,
      responsavelId: `responsible-${suffix}`,
      responsavelNome: 'Integration Test Responsible',
      totalAlunos: 1,
      monthlyValue: 250,
      enrollmentFeeValue: 0,
      billingType: 'PIX' as const,
      cycle: 'MONTHLY' as const,
      nextDueDate: '2026-11-10',
      endDate: '2027-10-31',
      enrollmentFeeDueDate: '2026-11-10',
      description: `Family billing integration ${suffix}`,
      actorId: `actor-${suffix}`,
    });
    const enqueueFor = (contaId: string) => ({
      contaId,
      aggregateType: 'MATRICULA_FAMILIAR' as const,
      aggregateId,
      payload: payloadFor(contaId),
    });

    const [firstA, concurrentA] = await Promise.all([
      enqueueFamilyBillingOutbox!(enqueueFor(contaAId)),
      enqueueFamilyBillingOutbox!(enqueueFor(contaAId)),
    ]);
    const rowB = await enqueueFamilyBillingOutbox!(enqueueFor(contaBId));

    expect(firstA.id).toBe(concurrentA.id);
    expect(firstA).toMatchObject({ contaId: contaAId, dedupeKey });
    expect(rowB).toMatchObject({ contaId: contaBId, dedupeKey });
    expect(rowB.id).not.toBe(firstA.id);

    const rows = await database.familyBillingOutbox.findMany({
      where: { contaId: { in: [contaAId, contaBId] }, dedupeKey },
      orderBy: { contaId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.contaId).sort()).toEqual([contaAId, contaBId].sort());
    expect(rows.map((row) => row.dedupeKey)).toEqual([dedupeKey, dedupeKey]);
  }, 15_000);
});
