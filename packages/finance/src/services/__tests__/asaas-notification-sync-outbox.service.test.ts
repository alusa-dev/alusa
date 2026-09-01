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
    expect(prismaMock.asaasNotificationSyncOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'DONE' }),
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
    expect(prismaMock.asaasNotificationSyncOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-2' },
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
    expect(prismaMock.asaasNotificationSyncOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-3' },
        data: expect.objectContaining({ status: 'EXHAUSTED' }),
      }),
    );
    expect(exhaustedResult).toMatchObject({ failed: 1, exhausted: 1 });
  });
});
