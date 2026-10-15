import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    platformBillingWebhookEvent: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    platformBillingAuditLog: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    platformBillingNotificationOutbox: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@alusa/platform-billing', () => ({
  PlatformBillingError: class PlatformBillingError extends Error {},
  classifyPlatformBillingWebhookError: vi.fn(),
  computePlatformBillingWebhookNextAttemptAt: vi.fn(),
  createPrismaPlatformBillingStore: vi.fn(),
  hasExhaustedPlatformBillingWebhookAttempts: vi.fn(),
  processPersistedPlatformBillingWebhookEvent: vi.fn(),
}));
vi.mock('./platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('./platform-billing-notifications', () => ({
  notifyPlatformBillingEvent: vi.fn(),
}));

import { drainPlatformBillingNotificationOutbox, drainStripeWebhookWorker, listPlatformBillingNotificationOutbox, listStripeWebhookEvents, replayPlatformBillingNotifications, replayStripeWebhookEvents } from './webhook-worker';
import { notifyPlatformBillingEvent } from './platform-billing-notifications';
import { classifyPlatformBillingWebhookError, createPrismaPlatformBillingStore, PlatformBillingError, processPersistedPlatformBillingWebhookEvent } from '@alusa/platform-billing';

describe('platform billing webhook worker persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.platformBillingWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.platformBillingAuditLog.createMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingNotificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: unknown) => unknown) => callback(prismaMock));
  });

  it('lista apenas eventos do tenant autenticado', async () => {
    await listStripeWebhookEvents({
      contaId: 'conta-a',
      environment: 'TEST',
      status: ['FAILED', 'EXHAUSTED'],
      limit: 25,
    });

    expect(prismaMock.platformBillingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        environment: 'TEST',
        status: { in: ['FAILED', 'EXHAUSTED'] },
      },
      take: 25,
    }));
  });

  it('restringe todas as mutações de replay a tenant ao receber IDs mistos e preserva auditoria', async () => {
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([
      { id: 'event-a', contaId: 'conta-a', eventId: 'stripe-event-a', eventType: 'invoice.paid' },
    ]);

    await replayStripeWebhookEvents({
      ids: ['event-a', 'event-b'],
      contaId: 'conta-a',
      actorUserId: 'user-a',
      reason: 'Retry operacional autorizado',
      environment: 'TEST',
    });

    expect(prismaMock.platformBillingWebhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['event-a', 'event-b'] },
        contaId: 'conta-a',
        environment: 'TEST',
      }),
      data: expect.objectContaining({
        status: 'PENDING',
        nextAttemptAt: expect.any(Date),
      }),
    }));
    expect(prismaMock.platformBillingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['event-a', 'event-b'] }, contaId: 'conta-a', environment: 'TEST' }),
    }));
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta-a',
        actorUserId: 'user-a',
        action: 'PLATFORM_BILLING_WEBHOOK_REPLAY_REQUESTED',
      }),
    }));
  });

  it('lists notification failures tenant-scoped and provides audited replay for exhausted items', async () => {
    prismaMock.platformBillingNotificationOutbox.findMany.mockResolvedValue([]);
    prismaMock.platformBillingNotificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingNotificationOutbox.findMany.mockResolvedValue([
      { id: 'outbox-a', eventId: 'evt-a', eventType: 'invoice.paid' },
    ]);
    await listPlatformBillingNotificationOutbox({ contaId: 'conta-a', environment: 'TEST', limit: 20 });
    await replayPlatformBillingNotifications({
      ids: ['outbox-a', 'outbox-b'], contaId: 'conta-a', actorUserId: 'user-a',
      reason: 'Retentativa após análise operacional', environment: 'TEST',
    });
    expect(prismaMock.platformBillingNotificationOutbox.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { contaId: 'conta-a', environment: 'TEST', status: { in: ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'] } },
    }));
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['outbox-a', 'outbox-b'] }, contaId: 'conta-a', environment: 'TEST', status: 'EXHAUSTED' },
      data: expect.objectContaining({ status: 'PENDING', attempts: 0 }),
    }));
    expect(prismaMock.platformBillingAuditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ contaId: 'conta-a', actorUserId: 'user-a', action: 'PLATFORM_BILLING_NOTIFICATION_REPLAY_REQUESTED' })],
    }));
  });

  it('marks the final failed notification attempt exhausted and stops automatic retries', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{
      id: 'outbox-exhausted', eventId: 'evt_exhausted', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 8,
    }]);
    vi.mocked(notifyPlatformBillingEvent).mockRejectedValueOnce(new Error('delivery failed'));
    const result = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-final' });
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 0, exhausted: 1 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'outbox-exhausted', status: 'PROCESSING', workerId: 'notify-final' },
      data: expect.objectContaining({ status: 'EXHAUSTED', lastError: 'delivery failed' }),
    }));
  });

  it('entrega notificações pelo outbox independente da inbox e cerca a confirmação pelo worker', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{
      id: 'outbox-1', eventId: 'evt_1', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1,
    }]);
    const result = await drainPlatformBillingNotificationOutbox({
      environment: 'TEST', workerId: 'notification-worker-a',
    });
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, exhausted: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'outbox-1', status: 'PROCESSING', workerId: 'notification-worker-a' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
  });

  it('retries a failed partial notification delivery with the same event idempotency identity', async () => {
    const record = { id: 'outbox-retry', eventId: 'evt_retry', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1 };
    prismaMock.$queryRaw.mockResolvedValueOnce([record]).mockResolvedValueOnce([{ ...record, attempts: 2 }]);
    vi.mocked(notifyPlatformBillingEvent)
      .mockRejectedValueOnce(new Error('email failed after inbox notification was persisted'))
      .mockResolvedValueOnce(undefined);
    const first = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-a' });
    const second = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-b' });
    expect(first).toMatchObject({ claimed: 1, delivered: 0, failed: 1 });
    expect(second).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'outbox-retry', status: 'PROCESSING', workerId: 'notify-a' },
      data: expect.objectContaining({ status: 'FAILED', lastError: expect.stringContaining('email failed') }),
    }));
    expect(vi.mocked(notifyPlatformBillingEvent).mock.calls.map(([input]) => [input.contaId, input.eventId, input.eventType]))
      .toEqual([['conta-a', 'evt_retry', 'invoice.payment_failed'], ['conta-a', 'evt_retry', 'invoice.payment_failed']]);
  });

  it('does not let an expired worker lease confirm delivery after another claimant takes over', async () => {
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const item = { id: 'outbox-race', eventId: 'evt_race', eventType: 'invoice.payment_failed', contaId: 'conta-a', attempts: 1 };
    prismaMock.$queryRaw.mockResolvedValueOnce([item]).mockResolvedValueOnce([{ ...item, attempts: 2 }]);
    vi.mocked(notifyPlatformBillingEvent)
      .mockImplementationOnce(async () => deliveryGate)
      .mockResolvedValueOnce(undefined);
    prismaMock.platformBillingNotificationOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const firstPromise = drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-stale' });
    await vi.waitFor(() => expect(notifyPlatformBillingEvent).toHaveBeenCalledTimes(1));
    const second = await drainPlatformBillingNotificationOutbox({ environment: 'TEST', workerId: 'notify-current' });
    releaseDelivery();
    const first = await firstPromise;
    expect(second).toMatchObject({ claimed: 1, delivered: 1 });
    expect(first).toMatchObject({ claimed: 1, delivered: 0 });
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'outbox-race', status: 'PROCESSING', workerId: 'notify-current' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
    expect(prismaMock.platformBillingNotificationOutbox.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'outbox-race', status: 'PROCESSING', workerId: 'notify-stale' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
  });

  it('exhausts a permanent webhook error on the first worker attempt', async () => {
    const event = {
      id: 'inbox-permanent', eventId: 'evt_permanent', eventType: 'invoice.paid',
      contaId: 'conta-a', attempts: 1, payload: { id: 'evt_permanent', type: 'invoice.paid', data: { object: {} } },
    };
    prismaMock.$queryRaw.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
    const permanentError = Object.assign(new PlatformBillingError('Unknown Stripe price.', 'PLATFORM_PRICE_UNKNOWN'), { code: 'PLATFORM_PRICE_UNKNOWN' });
    vi.mocked(processPersistedPlatformBillingWebhookEvent).mockRejectedValueOnce(permanentError);
    vi.mocked(classifyPlatformBillingWebhookError).mockReturnValueOnce('PERMANENT');
    vi.mocked(createPrismaPlatformBillingStore).mockReturnValue({
      markWebhookEventFailed: vi.fn().mockResolvedValue(undefined),
      markWebhookEventProcessed: vi.fn(),
    } as never);

    const result = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST', workerId: 'worker-permanent' });
    expect(result).toMatchObject({ claimed: 1, exhausted: 1, failed: 0 });
    expect(classifyPlatformBillingWebhookError).toHaveBeenCalledWith(permanentError);
    expect(vi.mocked(createPrismaPlatformBillingStore).mock.results.at(-1)?.value.markWebhookEventFailed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inbox-permanent', errorCode: 'PLATFORM_PRICE_UNKNOWN', exhausted: true, nextAttemptAt: undefined,
    }));
  });

  it('generates a distinct lease owner for every drain invocation by default', async () => {
    const first = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST' });
    const second = await drainStripeWebhookWorker({ prisma: prismaMock as never, environment: 'TEST' });

    expect(first.workerId).toBeTruthy();
    expect(second.workerId).toBeTruthy();
    expect(second.workerId).not.toBe(first.workerId);
  });
});
