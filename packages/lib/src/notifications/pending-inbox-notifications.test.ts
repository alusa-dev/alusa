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
    mocks.createBillingWebhookNotification.mockResolvedValue({ outcome: 'completed', notificationId: 'notification-1' });
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

  it('conclui resultado não aplicável sem exigir notificationId', async () => {
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'not_applicable', reason: 'event_ticket_payment', notificationId: null,
    });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 1, failed: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DONE', lastError: null }),
    }));
  });

  it('conclui notificação sem destinatários mesmo com notificationId nulo', async () => {
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'completed', notificationId: null, created: false, recipientCount: 0,
    });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 1, failed: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DONE' }),
    }));
  });

  it('preserva retry para entidade local temporariamente ausente', async () => {
    mocks.queryRaw.mockResolvedValue([row({ attempts: 2 })]);
    mocks.createBillingWebhookNotification.mockResolvedValue({ outcome: 'entity_missing', notificationId: null });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', lastError: 'Entidade local ainda não disponível' }),
    }));
  });

  it('marca entity_missing como FAILED ao esgotar tentativas', async () => {
    mocks.queryRaw.mockResolvedValue([row({ attempts: 5, maxAttempts: 5 })]);
    mocks.createBillingWebhookNotification.mockResolvedValue({ outcome: 'entity_missing', notificationId: null });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 1 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        lastError: 'Entidade local não encontrada após tentativas máximas',
      }),
    }));
  });

  it('aplica retry para falha técnica transitória', async () => {
    mocks.queryRaw.mockResolvedValue([row({ attempts: 2 })]);
    mocks.createBillingWebhookNotification.mockRejectedValue(new Error('transient database failure'));

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', lastError: 'transient database failure' }),
    }));
  });

  it('falha falha técnica ao esgotar tentativas', async () => {
    mocks.queryRaw.mockResolvedValue([row({ attempts: 5, maxAttempts: 5 })]);
    mocks.createBillingWebhookNotification.mockRejectedValue(new Error('persistent database failure'));

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 1 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', lastError: 'persistent database failure' }),
    }));
  });

  it('não conta item como processado se o fencing token perdeu a lease', async () => {
    mocks.queryRaw.mockResolvedValue([row()]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pending-1', status: 'PROCESSING', processingToken: 'claim-1' }),
    }));
  });

  it('falha conflito permanente de origem com motivo diagnosticável, sem retry', async () => {
    mocks.queryRaw.mockResolvedValue([row({ attempts: 1 })]);
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'inconsistent', reason: 'event_order_sale_link_conflict', notificationId: null,
    });

    const result = await processPendingInboxNotifications({ contaId: 'conta-1' });

    expect(result).toEqual({ attempted: 1, processed: 0, failed: 1 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', lastError: 'event_order_sale_link_conflict' }),
    }));
  });
});
