import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  asaasNotificationPreferenceOutbox: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
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
        where: expect.objectContaining({ id: 'outbox-1', status: 'PENDING' }),
        data: expect.objectContaining({ status: 'PROCESSING', claimToken: expect.any(String) }),
      }),
    );
    expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledWith('conta-1', 'cus_1');
    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: expect.any(String) }),
        data: expect.objectContaining({ status: 'DONE', claimToken: null, lastError: null }),
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

    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'outbox-2', status: 'PROCESSING', claimToken: expect.any(String) }),
        data: expect.objectContaining({
          status: 'FAILED',
          claimToken: null,
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

  it('persists a tenant-scoped retry, recovers it when due, and suppresses DONE duplicates', async () => {
    const startedAt = new Date('2026-10-16T12:00:00.000Z');
    const rows = new Map([
      ['outbox-a', {
        id: 'outbox-a', contaId: 'conta-a', asaasCustomerId: 'cus-a',
        status: 'FAILED', attempts: 1, nextAttemptAt: startedAt, processingAt: null, claimToken: null,
      }],
      ['outbox-b', {
        id: 'outbox-b', contaId: 'conta-b', asaasCustomerId: 'cus-b',
        status: 'FAILED', attempts: 4, nextAttemptAt: startedAt, processingAt: null, claimToken: null,
      }],
    ]);
    const eligibleRows = (contaId: string | undefined, now: Date) => [...rows.values()]
      .filter((row) => (!contaId || row.contaId === contaId)
        && (row.status === 'PENDING' || row.status === 'FAILED')
        && row.nextAttemptAt <= now);
    const expectedQueueQuery = (now: Date) => expect.objectContaining({
      where: {
        contaId: 'conta-a',
        OR: [
          {
            status: { in: ['PENDING', 'FAILED'] },
            nextAttemptAt: { lte: now },
          },
          {
            status: 'PROCESSING',
            processingAt: { lt: new Date(now.getTime() - 15 * 60_000) },
          },
        ],
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockImplementation(async ({ where }) =>
      eligibleRows(where.contaId, new Date()),
    );
    prismaMock.asaasNotificationPreferenceOutbox.updateMany.mockImplementation(async ({ where, data }) => {
      const row = rows.get(where.id);
      if (!row || row.status !== where.status
        || (where.processingAt !== undefined && row.processingAt !== where.processingAt)
        || (where.claimToken !== undefined && row.claimToken !== where.claimToken)) return { count: 0 };
      const nextRow = { ...row, ...data };
      if (data.attempts && typeof data.attempts === 'object' && 'increment' in data.attempts) {
        nextRow.attempts = row.attempts + data.attempts.increment;
      }
      rows.set(row.id, nextRow);
      return { count: 1 };
    });
    vi.mocked(applyAsaasNotificationPreferencesToCustomer)
      .mockRejectedValueOnce(new Error('temporary Asaas outage'))
      .mockResolvedValueOnce({ updated: true, total: 2 });

    try {
      const firstAttempt = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });
      const expectedRetryAt = new Date(startedAt.getTime() + 4 * 60_000);

      expect(firstAttempt).toMatchObject({ scanned: 1, failed: 1, processed: 0 });
      expect(rows.get('outbox-a')).toMatchObject({
        status: 'FAILED', attempts: 2, claimToken: null, lastError: 'temporary Asaas outage', nextAttemptAt: expectedRetryAt,
      });
      expect(rows.get('outbox-b')).toMatchObject({ status: 'FAILED', attempts: 4, nextAttemptAt: startedAt });
      expect(prismaMock.asaasNotificationPreferenceOutbox.findMany).toHaveBeenNthCalledWith(
        1, expectedQueueQuery(startedAt),
      );
      expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledTimes(1);
      expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledWith('conta-a', 'cus-a');

      const beforeDue = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });
      expect(beforeDue).toMatchObject({ scanned: 0, processed: 0, failed: 0 });
      expect(prismaMock.asaasNotificationPreferenceOutbox.findMany).toHaveBeenNthCalledWith(
        2, expectedQueueQuery(startedAt),
      );
      expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4 * 60_000 + 1);
      const recoveryTime = new Date(startedAt.getTime() + 4 * 60_000 + 1);
      const recovered = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });

      expect(recovered).toMatchObject({ scanned: 1, processed: 1, failed: 0, updated: 1 });
      expect(prismaMock.asaasNotificationPreferenceOutbox.findMany).toHaveBeenNthCalledWith(
        3, expectedQueueQuery(recoveryTime),
      );
      expect(rows.get('outbox-a')).toMatchObject({ status: 'DONE', attempts: 3, claimToken: null, lastError: null });
      expect(rows.get('outbox-b')).toMatchObject({ status: 'FAILED', attempts: 4 });
      expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenNthCalledWith(2, 'conta-a', 'cus-a');

      const afterDone = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });
      expect(afterDone).toMatchObject({ scanned: 0, processed: 0, failed: 0 });
      expect(prismaMock.asaasNotificationPreferenceOutbox.findMany).toHaveBeenNthCalledWith(
        4, expectedQueueQuery(recoveryTime),
      );
      expect(rows.get('outbox-a')).toMatchObject({ status: 'DONE', attempts: 3 });
      expect(rows.get('outbox-b')).toMatchObject({ status: 'FAILED', attempts: 4 });
      expect(applyAsaasNotificationPreferencesToCustomer).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('não finaliza a operação se outro worker substituiu o fencing token', async () => {
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([{
      id: 'outbox-stale',
      contaId: 'conta-a',
      asaasCustomerId: 'cus-a',
      status: 'PENDING',
      attempts: 0,
      processingAt: null,
      claimToken: null,
    }]);
    prismaMock.asaasNotificationPreferenceOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    vi.mocked(applyAsaasNotificationPreferencesToCustomer).mockResolvedValue({ updated: true, total: 1 });

    const result = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });

    expect(result).toMatchObject({ scanned: 1, processed: 0, failed: 0, exhausted: 0 });
    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PROCESSING', claimToken: expect.any(String) }),
        data: expect.objectContaining({ status: 'DONE', claimToken: null }),
      }),
    );
    expect(prismaMock.asaasNotificationPreferenceOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uq_asaas_notif_outbox_conta_dedupe: { contaId: 'conta-a', dedupeKey: 'tenant-preferences:cus-a' } },
        update: expect.objectContaining({ status: 'PENDING', attempts: 0, claimToken: null }),
        create: expect.objectContaining({ contaId: 'conta-a', asaasCustomerId: 'cus-a' }),
      }),
    );
  });

  it('move registros que atingiram o limite para EXHAUSTED sem nova chamada externa', async () => {
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([{
      id: 'outbox-exhausted',
      contaId: 'conta-a',
      asaasCustomerId: 'cus-a',
      status: 'FAILED',
      attempts: 8,
      processingAt: null,
      claimToken: null,
    }]);

    const result = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-a' });

    expect(result).toMatchObject({ scanned: 1, failed: 0, exhausted: 1 });
    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'outbox-exhausted',
          contaId: 'conta-a',
          status: 'FAILED',
          processingAt: null,
          claimToken: null,
        }),
        data: { status: 'EXHAUSTED', processingAt: null, claimToken: null },
      }),
    );
    expect(applyAsaasNotificationPreferencesToCustomer).not.toHaveBeenCalled();
  });
});
