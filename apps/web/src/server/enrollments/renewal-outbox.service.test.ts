import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createStandaloneChargeMock, createRenewalPendingMock } = vi.hoisted(() => ({
  createStandaloneChargeMock: vi.fn(),
  createRenewalPendingMock: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  createStandaloneCharge: createStandaloneChargeMock,
}));

vi.mock('./renewal-governance.service', () => ({
  createRenewalPending: createRenewalPendingMock,
}));

import { processRenewalOutbox } from './renewal-outbox.service';

function buildEvent() {
  return {
    id: 'renewal-event-1',
    contaId: 'conta-a',
    processoId: 'process-1',
    eventType: 'UNSUPPORTED_EVENT',
    payload: {},
    status: 'PENDING',
    attempts: 1,
    availableAt: new Date('2026-08-13T10:00:00.000Z'),
    lockedAt: null,
    leaseExpiresAt: null,
    lockToken: null,
    processedAt: null,
    lastError: null,
    dedupeKey: 'renewal-1',
    createdAt: new Date('2026-08-13T09:00:00.000Z'),
    updatedAt: new Date('2026-08-13T09:00:00.000Z'),
  };
}

function buildFinanceAgreement(effectiveAt: Date) {
  return {
    id: 'agreement-a',
    processoId: 'process-1',
    contaId: 'conta-a',
    status: 'SCHEDULED',
    effectiveAt,
    monthlyTotal: { toString: () => '120.00' },
    firstDueDate: null,
    asaasSubscriptionId: null,
    snapshot: null,
    responsavelId: 'responsavel-a',
    matriculaFuturaId: 'matricula-futura-a',
    processo: {
      status: 'CONFIRMED',
      itens: [{
        decision: 'RENEW',
        matriculaFuturaId: 'matricula-futura-a',
        matriculaFutura: {
          id: 'matricula-futura-a',
          alunoId: 'aluno-a',
          responsavelFinanceiroId: 'responsavel-a',
          formaPagamento: 'PIX',
          formaPagamentoTaxa: null,
          dataFimContrato: new Date('2027-06-30T00:00:00.000Z'),
          vencimentoDia: 10,
          descontoAntecipado: null,
          descontoTipo: null,
          prazoDesconto: null,
          jurosMensal: null,
          multaPercentual: null,
          plano: { periodicidade: 'MENSAL' },
          combo: null,
        },
      }],
    },
  };
}

type StatefulOutboxRow = ReturnType<typeof buildEvent>;

function createStatefulPrisma(
  rows: StatefulOutboxRow[],
  agreement: ReturnType<typeof buildFinanceAgreement>,
  beforeFindMany?: () => Promise<void>,
) {
  const isDue = (row: StatefulOutboxRow, where: Record<string, unknown>) => {
    const availableAt = where.availableAt as { lte?: Date } | undefined;
    const attempts = where.attempts as { lt?: number } | undefined;
    const status = where.status as string | { in?: string[] } | undefined;
    return row.contaId === where.contaId
      && (typeof status === 'string' ? row.status === status : !status?.in || status.in.includes(row.status))
      && (!availableAt?.lte || row.availableAt <= availableAt.lte)
      && (!attempts?.lt || row.attempts < attempts.lt);
  };
  const transactionClient = {
    rematriculaOutbox: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        await beforeFindMany?.();
        return rows.filter((row) => isDue(row, where)).map((row) => ({ ...row }));
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((candidate) => candidate.contaId === where.contaId
          && (where.id === undefined || candidate.id === where.id)
          && (typeof where.status !== 'string' || candidate.status === where.status)
          && (!where.lockToken || candidate.lockToken === where.lockToken)
          && isDue(candidate, where));
        if (!row) return { count: 0 };
        if (typeof data.attempts === 'object' && data.attempts && 'increment' in data.attempts) {
          row.attempts += Number((data.attempts as { increment: number }).increment);
        }
        Object.assign(row, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'attempts')));
        if (typeof data.attempts === 'number') row.attempts = data.attempts;
        return { count: 1 };
      }),
    },
    acordoFinanceiroFuturo: {
      findFirst: vi.fn(async ({ where }: { where: { contaId: string; id?: string } }) =>
        where.contaId === agreement.contaId && where.id === agreement.id ? { ...agreement } : null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(agreement, data);
        return agreement;
      }),
    },
    conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
    matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...transactionClient,
    $transaction: vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => callback(transactionClient)),
  };
  return prisma;
}

function createBarrier(participantCount: number) {
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === participantCount) release();
    await gate;
  };
}

describe('renewal outbox leases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recupera PROCESSING expirado e não sobrescreve o evento quando perde o fencing token', async () => {
    const prisma = {
      rematriculaOutbox: {
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([buildEvent()]),
      },
    };

    const result = await processRenewalOutbox(
      { contaId: 'conta-a', now: new Date('2026-08-13T10:00:00.000Z'), limit: 1 },
      { prisma } as never,
    );

    expect(result).toEqual([
      expect.objectContaining({
        eventId: 'renewal-event-1',
        status: 'SKIPPED',
        error: 'LEASE_LOST',
      }),
    ]);
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-a',
          status: 'PROCESSING',
          OR: expect.arrayContaining([
            expect.objectContaining({ leaseExpiresAt: expect.objectContaining({ lte: expect.any(Date) }) }),
            expect.objectContaining({ leaseExpiresAt: null }),
          ]),
        }),
      }),
    );
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PROCESSING',
          leaseExpiresAt: expect.any(Date),
          lockToken: expect.any(String),
        }),
      }),
    );
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSING',
          lockToken: expect.any(String),
        }),
      }),
    );
  });

  it('retenta provisionamento apenas quando disponível e converge após a vigência, isolado por conta', async () => {
    const initialNow = new Date('2026-08-13T23:58:00.000Z');
    const dueAt = new Date('2026-08-14T00:03:00.000Z');
    const futureAt = new Date('2026-08-14T00:04:00.000Z');
    const rows = [
      { ...buildEvent(), eventType: 'PROVISION_FUTURE_FINANCE', attempts: 0, payload: { acordoFinanceiroFuturoId: 'agreement-a' } },
      { ...buildEvent(), id: 'renewal-event-b', contaId: 'conta-b', attempts: 0 },
    ];
    let effectiveAt = futureAt;
    const agreement = {
      id: 'agreement-a',
      processoId: 'process-1',
      contaId: 'conta-a',
      status: 'SCHEDULED',
      effectiveAt,
      monthlyTotal: { toString: () => '120.00' },
      firstDueDate: null,
      asaasSubscriptionId: null,
      snapshot: null,
      responsavelId: 'responsavel-a',
      matriculaFuturaId: 'matricula-futura-a',
      processo: {
        status: 'CONFIRMED',
        itens: [{
          decision: 'RENEW',
          matriculaFuturaId: 'matricula-futura-a',
          matriculaFutura: {
            id: 'matricula-futura-a',
            alunoId: 'aluno-a',
            responsavelFinanceiroId: 'responsavel-a',
            formaPagamento: 'PIX',
            formaPagamentoTaxa: null,
            dataFimContrato: new Date('2027-06-30T00:00:00.000Z'),
            vencimentoDia: 10,
            descontoAntecipado: null,
            descontoTipo: null,
            prazoDesconto: null,
            jurosMensal: null,
            multaPercentual: null,
            plano: { periodicidade: 'MENSAL' },
            combo: null,
          },
        }],
      },
    };
    const isDue = (row: typeof rows[number], where: Record<string, unknown>) => {
      const availableAt = where.availableAt as { lte?: Date } | undefined;
      const attempts = where.attempts as { lt?: number } | undefined;
      const status = where.status as string | { in?: string[] } | undefined;
      return row.contaId === where.contaId
        && (typeof status === 'string' ? row.status === status : !status?.in || status.in.includes(row.status))
        && (!availableAt?.lte || row.availableAt <= availableAt.lte)
        && (!attempts?.lt || row.attempts < attempts.lt);
    };
    const transactionClient = {
      rematriculaOutbox: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          rows.filter((row) => isDue(row, where)).map((row) => ({ ...row }))),
        updateMany: vi.fn(async ({ where, data }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((candidate) => candidate.id === where.id
            && candidate.contaId === where.contaId
            && (typeof where.status !== 'string' || candidate.status === where.status)
            && (!where.lockToken || candidate.lockToken === where.lockToken)
            && isDue(candidate, where));
          if (!row) return { count: 0 };
          if (typeof data.attempts === 'object' && data.attempts && 'increment' in data.attempts) {
            row.attempts += Number((data.attempts as { increment: number }).increment);
          }
          Object.assign(row, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'attempts')));
          if (typeof data.attempts === 'number') {
            row.attempts = data.attempts;
          }
          return { count: 1 };
        }),
      },
      acordoFinanceiroFuturo: {
        findFirst: vi.fn(async ({ where }: { where: { contaId: string; id?: string } }) =>
          where.contaId === 'conta-a' && where.id === 'agreement-a'
            ? { ...agreement, effectiveAt }
            : null),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(agreement, data);
          return agreement;
        }),
      },
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...transactionClient,
      $transaction: vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => callback(transactionClient)),
    };

    createStandaloneChargeMock.mockResolvedValue({
      success: true,
      data: { chargeId: 'charge-a', asaasSubscriptionId: 'subscription-a', externalReference: 'renewal-a' },
    });

    const firstAttempt = await processRenewalOutbox({ contaId: 'conta-a', now: initialNow }, { prisma } as never);
    expect(firstAttempt).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'RENEWAL_NOT_YET_EFFECTIVE' }),
    ]);
    expect(rows[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      availableAt: dueAt,
      lastError: 'RENEWAL_NOT_YET_EFFECTIVE',
    });
    expect(rows[1]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(createStandaloneChargeMock).not.toHaveBeenCalled();

    const beforeDue = await processRenewalOutbox(
      { contaId: 'conta-a', now: new Date(dueAt.getTime() - 1) },
      { prisma } as never,
    );
    expect(beforeDue).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'FAILED', attempts: 1, availableAt: dueAt });

    effectiveAt = dueAt;
    const recovered = await processRenewalOutbox({ contaId: 'conta-a', now: dueAt }, { prisma } as never);
    expect(recovered).toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(rows[0]).toMatchObject({ status: 'PROCESSED', attempts: 2, processedAt: expect.any(Date) });
    expect(agreement).toMatchObject({ status: 'ACTIVE', asaasSubscriptionId: 'subscription-a' });
    expect(createStandaloneChargeMock).toHaveBeenCalledTimes(1);
    expect(createStandaloneChargeMock).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a' }));
    expect(rows[1]).toMatchObject({ status: 'PENDING', attempts: 0 });

    for (const call of prisma.rematriculaOutbox.findMany.mock.calls) {
      expect(call[0].where.contaId).toBe('conta-a');
    }
    for (const call of prisma.rematriculaOutbox.updateMany.mock.calls) {
      expect(call[0].where.contaId).toBe('conta-a');
    }
    expect(prisma.acordoFinanceiroFuturo.findFirst.mock.calls.every(([args]) => args.where.contaId === 'conta-a'))
      .toBe(true);
  });

  it('aplica backoff crescente após falhas do provider e processa no vencimento do retry', async () => {
    const initialNow = new Date('2026-08-13T10:00:00.000Z');
    const firstRetryAt = new Date('2026-08-13T10:05:00.000Z');
    const secondRetryAt = new Date('2026-08-13T10:25:00.000Z');
    const rows: StatefulOutboxRow[] = [
      {
        ...buildEvent(),
        eventType: 'PROVISION_FUTURE_FINANCE',
        attempts: 0,
        payload: { acordoFinanceiroFuturoId: 'agreement-a' },
      },
      { ...buildEvent(), id: 'renewal-event-b', contaId: 'conta-b', attempts: 0 },
    ];
    const agreement = buildFinanceAgreement(new Date('2026-08-12T00:00:00.000Z'));
    const prisma = createStatefulPrisma(rows, agreement);
    createRenewalPendingMock.mockResolvedValue(undefined);
    createStandaloneChargeMock
      .mockResolvedValueOnce({ success: false, error: 'ASAAS_TEMPORARY_FAILURE' })
      .mockResolvedValueOnce({ success: false, error: 'ASAAS_TEMPORARY_FAILURE' })
      .mockResolvedValueOnce({
        success: true,
        data: { chargeId: 'charge-a', asaasSubscriptionId: 'subscription-a', externalReference: 'renewal-a' },
      });

    const firstFailure = await processRenewalOutbox({ contaId: 'conta-a', now: initialNow }, { prisma } as never);
    expect(firstFailure).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'ASAAS_TEMPORARY_FAILURE' }),
    ]);
    expect(rows[0]).toMatchObject({
      status: 'FAILED', attempts: 1, lastError: 'ASAAS_TEMPORARY_FAILURE', availableAt: firstRetryAt,
    });

    const beforeFirstRetry = await processRenewalOutbox(
      { contaId: 'conta-a', now: new Date(firstRetryAt.getTime() - 1) },
      { prisma } as never,
    );
    expect(beforeFirstRetry).toEqual([]);
    expect(createStandaloneChargeMock).toHaveBeenCalledTimes(1);

    const secondFailure = await processRenewalOutbox(
      { contaId: 'conta-a', now: firstRetryAt },
      { prisma } as never,
    );
    expect(secondFailure).toEqual([
      expect.objectContaining({ status: 'FAILED', error: 'ASAAS_TEMPORARY_FAILURE' }),
    ]);
    expect(rows[0]).toMatchObject({
      status: 'FAILED', attempts: 2, lastError: 'ASAAS_TEMPORARY_FAILURE', availableAt: secondRetryAt,
    });
    expect(createRenewalPendingMock).toHaveBeenCalledTimes(2);

    const beforeSecondRetry = await processRenewalOutbox(
      { contaId: 'conta-a', now: new Date(secondRetryAt.getTime() - 1) },
      { prisma } as never,
    );
    expect(beforeSecondRetry).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'FAILED', attempts: 2, availableAt: secondRetryAt });
    expect(createStandaloneChargeMock).toHaveBeenCalledTimes(2);

    const recovered = await processRenewalOutbox(
      { contaId: 'conta-a', now: secondRetryAt },
      { prisma } as never,
    );
    expect(recovered).toEqual([expect.objectContaining({ status: 'PROCESSED' })]);
    expect(rows[0]).toMatchObject({ status: 'PROCESSED', attempts: 3, processedAt: expect.any(Date) });
    expect(agreement).toMatchObject({ status: 'ACTIVE', asaasSubscriptionId: 'subscription-a' });
    expect(createStandaloneChargeMock).toHaveBeenCalledTimes(3);
    expect(createRenewalPendingMock).toHaveBeenCalledTimes(2);
    expect(rows[1]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(prisma.rematriculaOutbox.findMany.mock.calls.every(([args]) => args.where.contaId === 'conta-a'))
      .toBe(true);
    expect(prisma.rematriculaOutbox.updateMany.mock.calls.every(([args]) => args.where.contaId === 'conta-a'))
      .toBe(true);
  });

  it('permite apenas a um worker reivindicar o mesmo evento lido em paralelo', async () => {
    const now = new Date('2026-08-13T10:00:00.000Z');
    const rows: StatefulOutboxRow[] = [
      {
        ...buildEvent(),
        eventType: 'PROVISION_FUTURE_FINANCE',
        attempts: 0,
        payload: { acordoFinanceiroFuturoId: 'agreement-a' },
      },
      { ...buildEvent(), id: 'renewal-event-b', contaId: 'conta-b', attempts: 0 },
    ];
    const agreement = buildFinanceAgreement(new Date('2026-08-12T00:00:00.000Z'));
    const prisma = createStatefulPrisma(rows, agreement, createBarrier(2));
    createStandaloneChargeMock.mockResolvedValue({
      success: true,
      data: { chargeId: 'charge-a', asaasSubscriptionId: 'subscription-a', externalReference: 'renewal-a' },
    });

    const results = await Promise.all([
      processRenewalOutbox({ contaId: 'conta-a', now }, { prisma } as never),
      processRenewalOutbox({ contaId: 'conta-a', now }, { prisma } as never),
    ]);

    expect(results.flat().map((result) => result.status).sort()).toEqual(['PROCESSED', 'SKIPPED']);
    expect(rows[0]).toMatchObject({ status: 'PROCESSED', attempts: 1, processedAt: expect.any(Date) });
    expect(rows[1]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(createStandaloneChargeMock).toHaveBeenCalledTimes(1);
    expect(prisma.rematriculaOutbox.findMany).toHaveBeenCalledTimes(2);
    const claimCallIndexes = prisma.rematriculaOutbox.updateMany.mock.calls.flatMap(([args], index) =>
      args.data.status === 'PROCESSING' ? [index] : []);
    expect(claimCallIndexes).toHaveLength(2);
    const claimResults = await Promise.all(claimCallIndexes.map((index) =>
      prisma.rematriculaOutbox.updateMany.mock.results[index].value));
    expect(claimResults.map((result) => result.count).sort()).toEqual([0, 1]);
    expect(prisma.rematriculaOutbox.findMany.mock.calls.every(([args]) => args.where.contaId === 'conta-a'))
      .toBe(true);
    expect(prisma.rematriculaOutbox.updateMany.mock.calls.every(([args]) => args.where.contaId === 'conta-a'))
      .toBe(true);
  });
});
