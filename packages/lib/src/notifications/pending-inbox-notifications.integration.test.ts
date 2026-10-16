import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const notificationMocks = vi.hoisted(() => ({
  createBillingWebhookNotification: vi.fn(),
}));

vi.mock('../services/notifications.service', () => ({
  createBillingWebhookNotification: notificationMocks.createBillingWebhookNotification,
  isBillingNotificationEvent: () => true,
}));

function isSafeLocalTestDatabase(): boolean {
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
    const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(databaseUrl.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && (databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_'));
  } catch {
    return false;
  }
}

const safeLocalTestDatabase = isSafeLocalTestDatabase();

describe.skipIf(!safeLocalTestDatabase)('pending inbox notification claim/retry integration', () => {
  let prisma: typeof import('../prisma').prisma;
  let processPendingInboxNotifications: typeof import('./pending-inbox-notifications').processPendingInboxNotifications;
  const runId = randomUUID();
  const contaIds = [`pending-inbox-a-${runId}`, `pending-inbox-b-${runId}`];
  const rowIds = [`pending-inbox-row-a-${runId}`, `pending-inbox-row-b-${runId}`];

  beforeAll(async () => {
    // Import the database singleton only after the strict local-Postgres guard passed.
    [{ prisma }, { processPendingInboxNotifications }] = await Promise.all([
      import('../prisma'),
      import('./pending-inbox-notifications'),
    ]);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.pendingInboxNotification.deleteMany({ where: { id: { in: rowIds } } });
    await prisma.conta.deleteMany({ where: { id: { in: contaIds } } });
    await prisma.$disconnect();
  });

  it('claims one tenant row across concurrent drains, retries transient failure, then completes without touching tenant B', async () => {
    const now = new Date();
    const payloadFor = (contaId: string) => ({
      contaId,
      eventId: `event-${runId}`,
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentId: `payment-${runId}`,
      occurredAt: now.toISOString(),
      sourceType: 'ASAAS_WEBHOOK',
    });

    await prisma.conta.createMany({
      data: contaIds.map((id, index) => ({ id, nome: `Pending inbox integration ${index} ${runId}` })),
    });
    await prisma.pendingInboxNotification.createMany({
      data: contaIds.map((contaId, index) => ({
        id: rowIds[index],
        contaId,
        kind: 'BILLING_WEBHOOK',
        payload: payloadFor(contaId),
        dedupeKey: `pending-inbox-integration:${runId}:${index}`,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRetryAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
      })),
    });
    const seededA = await prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[0] } });
    expect(seededA).toMatchObject({ status: 'PENDING', attempts: 0, maxAttempts: 5 });

    let releaseFirstHandler!: () => void;
    let markFirstHandlerStarted!: () => void;
    const firstHandlerStarted = new Promise<void>((resolve) => { markFirstHandlerStarted = resolve; });
    const firstHandlerGate = new Promise<void>((resolve) => { releaseFirstHandler = resolve; });
    let successfulEffects = 0;
    notificationMocks.createBillingWebhookNotification
      .mockImplementationOnce(async () => {
        markFirstHandlerStarted();
        await firstHandlerGate;
        throw new Error('transient notification storage failure');
      })
      .mockImplementationOnce(async () => {
        successfulEffects += 1;
        return { outcome: 'completed', notificationId: `notification-${runId}` };
      });

    const firstDrain = processPendingInboxNotifications({ contaId: contaIds[0], limit: 1 });
    const firstClaimOutcome = await Promise.race([
      firstHandlerStarted.then(() => 'handler_started' as const),
      firstDrain.then((result) => `drain_finished_before_handler:${JSON.stringify(result)}`),
    ]);
    expect(firstClaimOutcome).toBe('handler_started');

    const concurrentDrain = await processPendingInboxNotifications({ contaId: contaIds[0], limit: 1 });
    expect(concurrentDrain).toEqual({ attempted: 0, processed: 0, failed: 0 });

    const [claimedAWhileHeld, untouchedBWhileHeld] = await Promise.all([
      prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[0] } }),
      prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[1] } }),
    ]);
    expect(claimedAWhileHeld).toMatchObject({ contaId: contaIds[0], status: 'PROCESSING', attempts: 1 });
    expect(untouchedBWhileHeld).toMatchObject({ contaId: contaIds[1], status: 'PENDING', attempts: 0 });

    releaseFirstHandler();
    const firstDrainResult = await firstDrain;
    expect(firstDrainResult).toEqual({ attempted: 1, processed: 0, failed: 0 });

    const retriedA = await prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[0] } });
    expect(retriedA).toMatchObject({
      contaId: contaIds[0],
      status: 'PENDING',
      attempts: 1,
      lastError: 'transient notification storage failure',
      processingToken: null,
    });
    await prisma.pendingInboxNotification.update({
      where: { id: rowIds[0] },
      data: { nextRetryAt: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
    });

    const retryResult = await processPendingInboxNotifications({ contaId: contaIds[0], limit: 1 });
    expect(retryResult).toEqual({ attempted: 1, processed: 1, failed: 0 });

    const [completedA, untouchedBAfter] = await Promise.all([
      prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[0] } }),
      prisma.pendingInboxNotification.findUniqueOrThrow({ where: { id: rowIds[1] } }),
    ]);
    expect(completedA).toMatchObject({ contaId: contaIds[0], status: 'DONE', attempts: 2, lastError: null });
    expect(untouchedBAfter).toMatchObject({ contaId: contaIds[1], status: 'PENDING', attempts: 0 });
    expect(notificationMocks.createBillingWebhookNotification).toHaveBeenCalledTimes(2);
    expect(successfulEffects).toBe(1);
    expect(notificationMocks.createBillingWebhookNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      contaId: contaIds[0],
      asaasPaymentId: `payment-${runId}`,
    }));
  }, 15_000);
});
