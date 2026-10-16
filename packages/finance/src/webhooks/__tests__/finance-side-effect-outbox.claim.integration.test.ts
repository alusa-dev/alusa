import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  emitBillingNotifications: vi.fn(),
}));

vi.mock('@alusa/lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotifications: mocks.emitBillingNotifications,
}));

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
let enqueueFinanceSideEffect: typeof import('../finance-side-effect-outbox.service').enqueueFinanceSideEffect | undefined;
let processFinanceWebhookSideEffectOutboxEvent: typeof import('../finance-side-effect-outbox.service').processFinanceWebhookSideEffectOutboxEvent | undefined;
let databasePrisma: typeof import('@alusa/database').prisma | undefined;

describe.skipIf(!safeLocalTestDatabase)('finance side-effect outbox PostgreSQL integration', () => {
  const database = db as PrismaClient;
  const suffix = randomUUID().replaceAll('-', '');
  const contaAId = `side-effect-a-${suffix}`;
  const contaBId = `side-effect-b-${suffix}`;
  const dedupeKey = `billing-notification:${suffix}`;
  let sideEffectOutbox: typeof import('@alusa/database').prisma.financeWebhookSideEffectOutbox;

  beforeAll(async () => {
    const [service, databaseModule] = await Promise.all([
      import('../finance-side-effect-outbox.service'),
      import('@alusa/database'),
    ]);
    enqueueFinanceSideEffect = service.enqueueFinanceSideEffect;
    processFinanceWebhookSideEffectOutboxEvent = service.processFinanceWebhookSideEffectOutboxEvent;
    databasePrisma = databaseModule.prisma;
    sideEffectOutbox = databasePrisma.financeWebhookSideEffectOutbox;

    await database.conta.createMany({
      data: [
        { id: contaAId, nome: `Side effect A ${suffix}` },
        { id: contaBId, nome: `Side effect B ${suffix}` },
      ],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.financeWebhookSideEffectOutbox.deleteMany({
      where: { contaId: { in: [contaAId, contaBId] }, dedupeKey },
    });
    await db.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    await db.$disconnect();
    await databasePrisma?.$disconnect();
  });

  it('deduplicates within Conta A, isolates Conta B, and claims the effect once under concurrent processing', async () => {
    mocks.emitBillingNotifications.mockReset();
    let releaseDelivery!: () => void;
    let signalDeliveryStarted!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => { signalDeliveryStarted = resolve; });
    const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    mocks.emitBillingNotifications.mockImplementation(async () => {
      signalDeliveryStarted();
      await deliveryGate;
    });

    const enqueue = (contaId: string) => enqueueFinanceSideEffect!({
      contaId,
      effectType: 'BILLING_NOTIFICATION',
      dedupeKey,
      payload: {
        candidate: {
          contaId,
          event: 'PAYMENT_RECEIVED',
          asaasPaymentId: `payment-${suffix}`,
        },
        sourceType: 'ASAAS_WEBHOOK',
      },
    });

    const [firstA, duplicateA] = await Promise.all([enqueue(contaAId), enqueue(contaAId)]);
    const rowB = await enqueue(contaBId);
    expect([firstA, duplicateA].filter((result) => result.enqueued)).toHaveLength(1);
    expect([firstA, duplicateA].filter((result) => result.skipped)).toHaveLength(1);
    expect(rowB).toEqual({ enqueued: true, skipped: false });

    const rowsA = await sideEffectOutbox.findMany({ where: { contaId: contaAId, dedupeKey } });
    const [rowForA] = rowsA;
    const rows = await sideEffectOutbox.findMany({
      where: { contaId: { in: [contaAId, contaBId] }, dedupeKey },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.contaId).sort()).toEqual([contaAId, contaBId].sort());
    expect(rowForA).toBeDefined();

    const firstProcessor = processFinanceWebhookSideEffectOutboxEvent!(rowForA!.id);
    await deliveryStarted;
    const concurrentProcessor = processFinanceWebhookSideEffectOutboxEvent!(rowForA!.id);
    const concurrentResult = await concurrentProcessor;
    releaseDelivery();
    const firstResult = await firstProcessor;

    expect(firstResult).toEqual({ processed: true });
    expect(concurrentResult).toEqual({ processed: false, reason: 'not_claimed' });
    expect(mocks.emitBillingNotifications).toHaveBeenCalledTimes(1);

    const finalRows = await sideEffectOutbox.findMany({
      where: { contaId: { in: [contaAId, contaBId] }, dedupeKey },
    });
    expect(finalRows.find((row) => row.contaId === contaAId)?.status).toBe('PROCESSED');
    expect(finalRows.find((row) => row.contaId === contaBId)?.status).toBe('PENDING');
  }, 15_000);
});
