import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  asaasNotificationSyncOutbox: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));

const auditRecordMock = vi.fn();
vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: auditRecordMock },
}));

const ensureCustomerNotificationsEnabledMock = vi.fn();
vi.mock('../customer-notification.service', () => ({
  ensureCustomerNotificationsEnabled: ensureCustomerNotificationsEnabledMock,
}));

const syncCustomerNotificationsForUserSelectionMock = vi.fn();
const channelPreferencesFromWizardSelectionMock = vi.fn((channels: string[]) => ({
  email: channels.includes('EMAIL'),
  sms: channels.includes('SMS'),
  whatsapp: channels.includes('WHATSAPP'),
}));
vi.mock('../sync-customer-notifications-at-charge', () => ({
  syncCustomerNotificationsForUserSelection: syncCustomerNotificationsForUserSelectionMock,
  channelPreferencesFromWizardSelection: channelPreferencesFromWizardSelectionMock,
}));

const {
  enqueueAsaasNotificationSync,
  processAsaasNotificationSyncOutbox,
} = await import('../asaas-notification-sync-outbox.service');

describe('asaas-notification-sync-outbox.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditRecordMock.mockResolvedValue({ id: 'audit-1' });
    prismaMock.asaasNotificationSyncOutbox.findUnique.mockResolvedValue(null);
    prismaMock.asaasNotificationSyncOutbox.findUniqueOrThrow.mockResolvedValue({ id: 'outbox-1' });
    prismaMock.asaasNotificationSyncOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    prismaMock.asaasNotificationSyncOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.asaasNotificationSyncOutbox.update.mockResolvedValue({});
    ensureCustomerNotificationsEnabledMock.mockResolvedValue({ success: true });
    syncCustomerNotificationsForUserSelectionMock.mockResolvedValue({
      success: true,
      applied: { email: true, sms: false, whatsapp: false },
      warnings: [],
    });
  });

  it('enfileira de forma idempotente por tenant, operação e canais', async () => {
    await enqueueAsaasNotificationSync({
      contaId: 'conta-1',
      asaasCustomerId: 'cus-1',
      channels: ['SMS', 'EMAIL', 'EMAIL'],
      externalReference: 'charge-ref-1',
      correlationId: 'corr-1',
      reason: 'NOTIFICATION_SYNC_FAILED',
    });

    expect(prismaMock.asaasNotificationSyncOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contaId: 'conta-1',
        asaasCustomerId: 'cus-1',
        dedupeKey: 'charge-notifications:charge-ref-1:EMAIL,SMS',
        requestedChannels: ['EMAIL', 'SMS'],
        externalReference: 'charge-ref-1',
      }),
    });
  });

  it('não cria uma segunda operação quando o mesmo item já existe', async () => {
    prismaMock.asaasNotificationSyncOutbox.findUnique.mockResolvedValueOnce({
      id: 'existing',
      status: 'DONE',
    });

    const result = await enqueueAsaasNotificationSync({
      contaId: 'conta-1',
      asaasCustomerId: 'cus-1',
      channels: ['EMAIL'],
      externalReference: 'charge-ref-1',
    });

    expect(result).toEqual({ id: 'existing', status: 'DONE' });
    expect(prismaMock.asaasNotificationSyncOutbox.create).not.toHaveBeenCalled();
  });

  it('processa o item, confirma o bloqueio global e marca DONE', async () => {
    prismaMock.asaasNotificationSyncOutbox.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        contaId: 'conta-1',
        asaasCustomerId: 'cus-1',
        status: 'PENDING',
        attempts: 0,
        requestedChannels: ['EMAIL'],
        externalReference: 'charge-ref-1',
        correlationId: 'corr-1',
        reason: 'retry',
      },
    ]);

    const result = await processAsaasNotificationSyncOutbox({ limit: 10 });

    expect(ensureCustomerNotificationsEnabledMock).toHaveBeenCalledWith('conta-1', 'cus-1');
    expect(syncCustomerNotificationsForUserSelectionMock).toHaveBeenCalledWith(
      'conta-1',
      'cus-1',
      { email: true, sms: false, whatsapp: false },
    );
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-1', contaId: 'conta-1' }),
        data: expect.objectContaining({ status: 'PROCESSING', claimToken: expect.any(String) }),
      }),
    );
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: expect.any(String) }),
        data: expect.objectContaining({ status: 'DONE', claimToken: null }),
      }),
    );
    expect(auditRecordMock.mock.calls.map(([call]) => call.action)).toEqual([
      'finance.notification_sync.started',
      'finance.notification_sync.success',
    ]);
    expect(result).toMatchObject({ scanned: 1, processed: 1, partial: 0, failed: 0 });
  });

  it('retenta falha e envia para EXHAUSTED no limite', async () => {
    prismaMock.asaasNotificationSyncOutbox.findMany
      .mockResolvedValueOnce([
        {
          id: 'outbox-2',
          contaId: 'conta-1',
          asaasCustomerId: 'cus-2',
          status: 'FAILED',
          attempts: 1,
          requestedChannels: ['SMS'],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'outbox-3',
          contaId: 'conta-1',
          asaasCustomerId: 'cus-3',
          status: 'FAILED',
          attempts: 2,
          requestedChannels: ['SMS'],
        },
      ]);
    ensureCustomerNotificationsEnabledMock.mockRejectedValue(new Error('Asaas indisponível'));

    const retryResult = await processAsaasNotificationSyncOutbox({ maxAttempts: 3 });
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-2' }),
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Asaas indisponível' }),
      }),
    );
    expect(retryResult).toMatchObject({ failed: 1, exhausted: 0 });

    vi.clearAllMocks();
    prismaMock.asaasNotificationSyncOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.asaasNotificationSyncOutbox.findMany.mockResolvedValue([
      {
        id: 'outbox-3',
        contaId: 'conta-1',
        asaasCustomerId: 'cus-3',
        status: 'FAILED',
        attempts: 2,
        requestedChannels: ['SMS'],
      },
    ]);
    ensureCustomerNotificationsEnabledMock.mockRejectedValue(new Error('Asaas indisponível'));
    auditRecordMock.mockResolvedValue({ id: 'audit-2' });

    const exhaustedResult = await processAsaasNotificationSyncOutbox({ maxAttempts: 3 });
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-3' }),
        data: expect.objectContaining({ status: 'EXHAUSTED' }),
      }),
    );
    expect(exhaustedResult).toMatchObject({ failed: 1, exhausted: 1 });
  });

  it('não finaliza nem reporta sucesso após perder o fencing token', async () => {
    prismaMock.asaasNotificationSyncOutbox.findMany.mockResolvedValue([{
      id: 'outbox-stale',
      contaId: 'conta-a',
      asaasCustomerId: 'cus-a',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 8,
      processingAt: null,
      claimToken: null,
      requestedChannels: ['EMAIL'],
    }]);
    prismaMock.asaasNotificationSyncOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await processAsaasNotificationSyncOutbox({ contaId: 'conta-a' });

    expect(result).toMatchObject({ scanned: 1, processed: 0, failed: 0, exhausted: 0 });
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PROCESSING', claimToken: expect.any(String) }),
        data: expect.objectContaining({ status: 'DONE', claimToken: null }),
      }),
    );
  });

  it('recupera e marca EXHAUSTED um registro PROCESSING vencido no limite', async () => {
    const staleAt = new Date(Date.now() - 30 * 60_000);
    prismaMock.asaasNotificationSyncOutbox.findMany.mockResolvedValue([{
      id: 'outbox-stale-exhausted',
      contaId: 'conta-a',
      asaasCustomerId: 'cus-a',
      status: 'PROCESSING',
      attempts: 3,
      maxAttempts: 3,
      processingAt: staleAt,
      claimToken: 'expired-claim',
      requestedChannels: ['EMAIL'],
    }]);

    const result = await processAsaasNotificationSyncOutbox({ contaId: 'conta-a' });

    expect(result).toMatchObject({ scanned: 1, processed: 0, failed: 0, exhausted: 1 });
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'outbox-stale-exhausted',
          contaId: 'conta-a',
          status: 'PROCESSING',
          attempts: { gte: 3 },
          processingAt: staleAt,
          claimToken: 'expired-claim',
        }),
        data: { status: 'EXHAUSTED', processingAt: null, claimToken: null },
      }),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'finance.notification_sync.exhausted',
      entity: { type: 'AsaasNotification', id: 'cus-a' },
      metadata: expect.objectContaining({ status: 'EXHAUSTED', outboxId: 'outbox-stale-exhausted' }),
    }));
    expect(ensureCustomerNotificationsEnabledMock).not.toHaveBeenCalled();
  });

  it('aplica o limite do caller a PROCESSING stale mesmo quando a linha persiste um limite maior', async () => {
    const staleAt = new Date(Date.now() - 30 * 60_000);
    prismaMock.asaasNotificationSyncOutbox.findMany.mockResolvedValue([{
      id: 'outbox-stale-caller-cap',
      contaId: 'conta-a',
      asaasCustomerId: 'cus-a',
      status: 'PROCESSING',
      attempts: 2,
      maxAttempts: 8,
      processingAt: staleAt,
      claimToken: 'expired-claim',
      requestedChannels: ['EMAIL'],
    }]);

    const result = await processAsaasNotificationSyncOutbox({ contaId: 'conta-a', maxAttempts: 2 });

    expect(result).toMatchObject({ scanned: 1, processed: 0, failed: 0, exhausted: 1 });
    expect(prismaMock.asaasNotificationSyncOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'outbox-stale-caller-cap',
          contaId: 'conta-a',
          status: 'PROCESSING',
          attempts: { gte: 2 },
          processingAt: staleAt,
          claimToken: 'expired-claim',
        }),
        data: { status: 'EXHAUSTED', processingAt: null, claimToken: null },
      }),
    );
    expect(ensureCustomerNotificationsEnabledMock).not.toHaveBeenCalled();
  });
});
