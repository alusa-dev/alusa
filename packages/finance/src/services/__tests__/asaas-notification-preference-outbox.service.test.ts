import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  asaasNotificationPreferenceOutbox: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../asaas-notification-preferences.service', () => ({
  applyAsaasNotificationPreferencesToCustomer: vi.fn(),
  listCustomerIdsWithAsaas: vi.fn(),
}));

const {
  enqueueAsaasNotificationPreferenceSync,
  processAsaasNotificationPreferenceOutbox,
} = await import('../asaas-notification-preference-outbox.service');
const { applyAsaasNotificationPreferencesToCustomer } = await import(
  '../asaas-notification-preferences.service'
);

describe('asaas-notification-preference-outbox.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.asaasNotificationPreferenceOutbox.upsert.mockResolvedValue({});
    prismaMock.asaasNotificationPreferenceOutbox.update.mockResolvedValue({});
    prismaMock.asaasNotificationPreferenceOutbox.updateMany.mockResolvedValue({ count: 1 });
  });

  it('enfileira por tenant/customer com chave idempotente', async () => {
    await enqueueAsaasNotificationPreferenceSync({
      contaId: 'conta-1',
      asaasCustomerId: 'cus_1',
      reason: 'TEST',
    });

    expect(prismaMock.asaasNotificationPreferenceOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uq_asaas_notif_outbox_conta_dedupe: {
            contaId: 'conta-1',
            dedupeKey: 'tenant-preferences:cus_1',
          },
        },
        update: expect.objectContaining({
          status: 'PENDING',
          attempts: 0,
          processedAt: null,
        }),
        create: expect.objectContaining({
          contaId: 'conta-1',
          asaasCustomerId: 'cus_1',
          dedupeKey: 'tenant-preferences:cus_1',
        }),
      }),
    );
  });

  it('processa item pendente e marca DONE sem duplicar claim', async () => {
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([
      {
        id: 'outbox-1',
        contaId: 'conta-1',
        asaasCustomerId: 'cus_1',
        status: 'PENDING',
        attempts: 0,
      },
    ]);
    vi.mocked(applyAsaasNotificationPreferencesToCustomer).mockResolvedValue({
      updated: true,
      total: 8,
    });

    const result = await processAsaasNotificationPreferenceOutbox({ limit: 10 });

    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledWith('conta-1', 'cus_1');
    expect(prismaMock.asaasNotificationPreferenceOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({ status: 'DONE', lastError: null }),
      }),
    );
    expect(result).toMatchObject({ processed: 1, updated: 1, failed: 0 });
  });

  it('marca FAILED com backoff quando a aplicação no Asaas falha', async () => {
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([
      {
        id: 'outbox-2',
        contaId: 'conta-1',
        asaasCustomerId: 'cus_2',
        status: 'FAILED',
        attempts: 2,
      },
    ]);
    vi.mocked(applyAsaasNotificationPreferencesToCustomer).mockRejectedValue(new Error('asaas down'));

    const result = await processAsaasNotificationPreferenceOutbox({ limit: 10 });

    expect(prismaMock.asaasNotificationPreferenceOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-2' },
        data: expect.objectContaining({
          status: 'FAILED',
          lastError: 'asaas down',
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(result.errors[0]).toEqual(
      expect.objectContaining({ id: 'outbox-2', asaasCustomerId: 'cus_2' }),
    );
  });
});
