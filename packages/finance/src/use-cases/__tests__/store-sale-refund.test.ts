import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { tx, prismaMock, preflightMock, auditMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    storeSaleReturn: { findFirst: vi.fn(), updateMany: vi.fn() },
    storeSaleRefundAttempt: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    tx,
    prismaMock: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) },
    preflightMock: vi.fn(),
    auditMock: vi.fn(),
  };
});

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../payment-command-preflight', () => ({ readPaymentFullPreflight: preflightMock }));
vi.mock('../../foundation/audit-log.service', () => ({ auditLogService: { record: auditMock } }));

import { requestStoreSaleRefund, StoreSaleRefundError } from '../store-sale-refund';

const paidCharge = {
  id: 'charge-a', status: 'PAID', value: new Prisma.Decimal(80), billingType: 'PIX', asaasPaymentId: 'payment-a',
};

function saleReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-a', saleId: 'sale-a', contaId: 'tenant-a', refundStatus: 'DENIED',
    refundRequestedAmount: new Prisma.Decimal(40), refundIssue: null, updatedAt: new Date(),
    attempts: [{
      id: 'attempt-denied', contaId: 'tenant-a', returnId: 'return-a', chargeId: 'charge-a',
      correlationId: 'old-correlation', idempotencyKey: 'old-key', status: 'DENIED',
      requestedAmount: new Prisma.Decimal(40), confirmedAmount: new Prisma.Decimal(0),
      providerRefundBaseline: new Prisma.Decimal(0), requestUrl: null, createdAt: new Date('2026-01-01'),
    }],
    sale: { finalizationType: 'COBRANCA', charge: paidCharge, standaloneInstallmentPlan: null },
    ...overrides,
  };
}

describe('requestStoreSaleRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.storeSaleReturn.findFirst.mockResolvedValue(saleReturn());
    tx.storeSaleRefundAttempt.create.mockResolvedValue({ id: 'attempt-retry', correlationId: 'new-correlation', status: 'REQUESTED' });
    tx.storeSaleRefundAttempt.upsert.mockResolvedValue({ id: 'attempt-request', correlationId: 'request-correlation', status: 'REQUESTED' });
    tx.storeSaleRefundAttempt.findMany.mockResolvedValue([]);
    tx.storeSaleRefundAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.storeSaleRefundAttempt.findMany.mockResolvedValue([{
      id: 'attempt-retry', contaId: 'tenant-a', returnId: 'return-a', chargeId: 'charge-a',
      correlationId: 'new-correlation', status: 'IN_PROGRESS', requestedAmount: new Prisma.Decimal(40),
      confirmedAmount: new Prisma.Decimal(0), requestUrl: null,
    }]);
    tx.storeSaleReturn.updateMany.mockResolvedValue({ count: 1 });
    preflightMock.mockResolvedValue({ refunds: [] });
    auditMock.mockResolvedValue({ id: 'audit-1' });
  });

  it('requires explicit retry mode for a definitive denial', async () => {
    const dispatch = vi.fn();

    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'FINANCEIRO',
      mode: 'REQUEST', dispatch,
    })).rejects.toMatchObject({ code: 'REEMBOLSO_NEGADO_RETRY_EXPLICITO' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(tx.storeSaleRefundAttempt.create).not.toHaveBeenCalled();
  });

  it('creates an auditable new attempt for explicit retry of DENIED only', async () => {
    const dispatch = vi.fn().mockResolvedValue({ status: 202, body: { success: true, pending: true } });

    const result = await requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'ADMIN',
      mode: 'RETRY_DENIED', dispatch,
    });

    expect(result).toEqual({ status: 'IN_PROGRESS', pending: true });
    expect(tx.storeSaleRefundAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'tenant-a', returnId: 'return-a', chargeId: 'charge-a',
        idempotencyKey: expect.stringMatching(/^store-return-retry-/),
        correlationId: expect.not.stringMatching(/^old-correlation$/),
      }),
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a', actorId: 'user-a', chargeId: 'charge-a', returnId: 'return-a',
      attemptId: 'attempt-retry', value: 40,
    }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'loja.sale.refund_retry_requested',
      metadata: expect.objectContaining({ mode: 'RETRY_DENIED' }),
    }));
  });

  it('creates retry attempts in the same transaction that claims the return', async () => {
    let claimed = false;
    tx.storeSaleReturn.updateMany.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { refundStatus: string } }).data;
      if (data.refundStatus === 'REQUESTED') claimed = true;
      return { count: 1 };
    });
    tx.storeSaleRefundAttempt.create.mockImplementation(async () => {
      expect(claimed).toBe(true);
      throw new Error('simulated database failure');
    });
    const dispatch = vi.fn();

    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'ADMIN',
      mode: 'RETRY_DENIED', dispatch,
    })).rejects.toThrow('simulated database failure');

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retries only denied installments when other latest installments are already refunded', async () => {
    const secondCharge = { ...paidCharge, id: 'charge-b', asaasPaymentId: 'payment-b' };
    tx.storeSaleReturn.findFirst.mockResolvedValue(saleReturn({
      attempts: [
        { ...saleReturn().attempts[0], chargeId: 'charge-a', status: 'REFUNDED', requestedAmount: new Prisma.Decimal(40) },
        { ...saleReturn().attempts[0], id: 'attempt-denied-b', chargeId: 'charge-b', status: 'DENIED', requestedAmount: new Prisma.Decimal(25) },
      ],
      sale: { finalizationType: 'COBRANCA', charge: paidCharge, standaloneInstallmentPlan: { charges: [secondCharge] } },
    }));
    tx.storeSaleRefundAttempt.create.mockResolvedValue({ id: 'attempt-retry-b', correlationId: 'retry-b', status: 'REQUESTED' });
    tx.storeSaleRefundAttempt.findMany.mockResolvedValue([
      { id: 'attempt-refunded-a', chargeId: 'charge-a', status: 'REFUNDED', requestedAmount: new Prisma.Decimal(40), confirmedAmount: new Prisma.Decimal(40), correlationId: 'old-a' },
      { id: 'attempt-retry-b', chargeId: 'charge-b', status: 'IN_PROGRESS', requestedAmount: new Prisma.Decimal(25), confirmedAmount: new Prisma.Decimal(0), correlationId: 'retry-b' },
    ]);
    tx.storeSaleRefundAttempt.findMany.mockResolvedValueOnce([]);
    const dispatch = vi.fn().mockResolvedValue({ status: 202, body: { success: true } });

    const result = await requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'FINANCEIRO',
      mode: 'RETRY_DENIED', dispatch,
    });

    expect(result).toEqual({ status: 'IN_PROGRESS', pending: true });
    expect(tx.storeSaleRefundAttempt.create).toHaveBeenCalledTimes(1);
    expect(tx.storeSaleRefundAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ chargeId: 'charge-b' }),
    }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ chargeId: 'charge-b', value: 25 }));
  });

  it('blocks every retry while provider outcome awaits reconciliation', async () => {
    tx.storeSaleReturn.findFirst.mockResolvedValue(saleReturn({
      refundStatus: 'NEEDS_RECONCILIATION',
      attempts: [{ ...saleReturn().attempts[0], status: 'NEEDS_RECONCILIATION' }],
    }));
    const dispatch = vi.fn();

    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'FINANCEIRO',
      mode: 'RETRY_DENIED', dispatch,
    })).rejects.toBeInstanceOf(StoreSaleRefundError);

    expect(dispatch).not.toHaveBeenCalled();
    expect(tx.storeSaleRefundAttempt.create).not.toHaveBeenCalled();
  });

  it('reserves the same payment capacity across different returns under the payment lock', async () => {
    tx.storeSaleRefundAttempt.findMany.mockResolvedValue([{
      returnId: 'return-other', chargeId: 'charge-a', status: 'IN_PROGRESS',
      requestedAmount: new Prisma.Decimal(50), confirmedAmount: new Prisma.Decimal(0),
    }]);
    const dispatch = vi.fn();

    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'ADMIN',
      mode: 'RETRY_DENIED', dispatch,
    })).rejects.toMatchObject({ code: 'SALDO_REEMBOLSO_INSUFICIENTE' });

    expect(tx.$queryRaw.mock.calls.some(([query]) => String(query).includes('pg_advisory_xact_lock'))).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(tx.storeSaleRefundAttempt.create).not.toHaveBeenCalled();
  });

  it('counts confirmed partial refunds and only reserves the unconfirmed part of open attempts', async () => {
    tx.storeSaleRefundAttempt.findMany.mockResolvedValue([
      {
        returnId: 'return-partial', chargeId: 'charge-a', status: 'PARTIALLY_REFUNDED',
        requestedAmount: new Prisma.Decimal(40), confirmedAmount: new Prisma.Decimal(20),
      },
      {
        returnId: 'return-open', chargeId: 'charge-a', status: 'IN_PROGRESS',
        requestedAmount: new Prisma.Decimal(25), confirmedAmount: new Prisma.Decimal(10),
      },
    ]);
    const dispatch = vi.fn();

    // Charge value 80 - confirmed 30 - open remainder 15 leaves 35, below this
    // return's requested 40. Counting only REFUNDED or reserving full 25 would
    // each miss part of the capacity already consumed.
    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'ADMIN',
      mode: 'RETRY_DENIED', dispatch,
    })).rejects.toMatchObject({ code: 'SALDO_REEMBOLSO_INSUFICIENTE' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(tx.storeSaleRefundAttempt.create).not.toHaveBeenCalled();
  });

  it('marks a thrown dispatch outcome for reconciliation and never reports it as denied', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('socket closed after request write'));

    await expect(requestStoreSaleRefund({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'FINANCEIRO',
      mode: 'RETRY_DENIED', dispatch,
    })).rejects.toMatchObject({ code: 'REEMBOLSO_AGUARDA_RECONCILIACAO' });

    expect(tx.storeSaleRefundAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'NEEDS_RECONCILIATION', providerStatus: 'DISPATCH_OUTCOME_UNKNOWN' }),
    }));
    expect(tx.storeSaleReturn.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refundStatus: 'NEEDS_RECONCILIATION' }),
    }));
  });
});
