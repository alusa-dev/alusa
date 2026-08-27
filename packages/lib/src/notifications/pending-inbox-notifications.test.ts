import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  createBillingWebhookNotification: vi.fn(),
}));

vi.mock('../prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    pendingInboxNotification: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock('../services/notifications.service', () => ({
  createBillingWebhookNotification: mocks.createBillingWebhookNotification,
  isBillingNotificationEvent: vi.fn(() => true),
}));

const { enqueuePendingBillingWebhookNotification, processPendingInboxNotifications } = await import('./pending-inbox-notifications');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pending-1',
    contaId: 'conta-1',
    kind: 'BILLING_WEBHOOK',
    payload: {
      contaId: 'conta-1',
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentId: 'pay-1',
    },
    dedupeKey: 'pending:billing:conta-1:PAYMENT_CONFIRMED:pay-1',
    attempts: 1,
    maxAttempts: 5,
    processingToken: 'claim-1',
    ...overrides,
  };
}

describe('pending inbox notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (_tx: unknown) => unknown) => callback({
      $executeRaw: mocks.executeRaw,
      $queryRaw: mocks.queryRaw,
    }));
    mocks.executeRaw.mockResolvedValue(0);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.createBillingWebhookNotification.mockResolvedValue({ notificationId: 'notification-1' });
  });

  it('processa itens reivindicados e usa o fencing token ao finalizar', async () => {
    mocks.queryRaw.mockResolvedValue([row()]);

    const result = await processPendingInboxNotifications({ contaId: 'conta-1', limit: 10 });

    expect(result).toEqual({ attempted: 1, processed: 1, failed: 0 });
    expect(mocks.createBillingWebhookNotification).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'pending-1',
        status: 'PROCESSING',
        processingToken: 'claim-1',
      }),
      data: expect.objectContaining({ status: 'DONE', processingToken: null }),
    }));
    expect(String(mocks.queryRaw.mock.calls[0]?.[0]?.sql ?? '')).toContain('SKIP LOCKED');
  });

  it('não permite que o payload troque o tenant persistido na fila', async () => {
    mocks.queryRaw.mockResolvedValue([row({ payload: {
      contaId: 'conta-2',
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentId: 'pay-1',
    } })]);

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 1 });
    expect(mocks.createBillingWebhookNotification).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', processingToken: null }),
    }));
  });

  it('não ressuscita nem rouba item que já está PROCESSING', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'pending-1', status: 'PROCESSING' });

    await enqueuePendingBillingWebhookNotification({
      contaId: 'conta-1',
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentId: 'pay-1',
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
