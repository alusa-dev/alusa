import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@alusa/database', () => ({ prisma: { $transaction: vi.fn() } }));

import { prisma } from '@alusa/database';
import { deleteEventCost, registerEventCostPayment, updateFinancialEntry } from './event-financial-operations';

function makeEntryState() {
  return {
    actual: 30,
    status: 'PARTIALLY_PAID',
    originType: 'MANUAL',
    originId: null as string | null,
    payments: [] as Array<Record<string, unknown>>,
    paymentProvider: null as string | null,
    asaasPaymentId: null as string | null,
    paymentStatus: null as string | null,
    event: { id: 'event-1', name: 'Evento', startsAt: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE' },
  };
}

function makeTransaction(state: ReturnType<typeof makeEntryState>) {
  const tx = {
    $executeRaw: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (_strings.join(' ').includes('pg_advisory_xact_lock')) return [];
      if (values.includes('conta-b')) return [];
      expect(values).toContain('conta-a');
      return [{
        id: 'entry-1', contaId: 'conta-a', eventId: 'event-1', type: 'COST', originType: state.originType, originId: state.originId,
        status: state.status, expectedAmount: new Prisma.Decimal(100), actualAmount: new Prisma.Decimal(state.actual), dueDate: new Date('2026-12-01T00:00:00.000Z'), eventStatus: 'ACTIVE',
      }];
    }),
    eventFinancialPayment: {
      findFirst: vi.fn(async ({ where }: { where: { idempotencyKey?: string; financialEntryId?: string } }) => state.payments.find((payment) => where.idempotencyKey ? payment.idempotencyKey === where.idempotencyKey : where.financialEntryId === 'entry-1') ?? null),
      findMany: vi.fn(async () => state.payments),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const payment = state.payments.find((candidate) => candidate.id === where.id);
        if (payment) Object.assign(payment, data);
        return { count: payment ? 1 : 0 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const payment = { id: `payment-${state.payments.length + 1}`, ...data, paidAt: data.paidAt, amount: data.amount, refundedAmount: data.refundedAmount, netAmount: data.netAmount };
        state.payments.push(payment);
        return payment;
      }),
    },
    eventFinancialEntry: {
      updateMany: vi.fn(async ({ data }: { data: { actualAmount: Prisma.Decimal; status: string } }) => {
        state.actual = data.actualAmount.toNumber();
        state.status = data.status;
        return { count: 1 };
      }),
      findFirst: vi.fn(async () => ({
        id: 'entry-1', contaId: 'conta-a', eventId: 'event-1', type: 'COST', category: 'Espaço', description: 'Locação',
        supplier: null, originType: state.originType, originId: state.originId, costClass: 'DIRECT', expectedAmount: new Prisma.Decimal(100),
        grossAmount: new Prisma.Decimal(100), discountAmount: new Prisma.Decimal(0), actualAmount: new Prisma.Decimal(state.actual),
        refundedAmount: new Prisma.Decimal(0), netAmount: null, dueDate: null, realizedAt: new Date(), status: state.status,
        paymentProvider: state.paymentProvider, asaasPaymentId: state.asaasPaymentId, paymentStatus: state.paymentStatus,
        paymentMethod: 'CASH', proofUrl: null, notes: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
        event: state.event, payments: state.payments,
      })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    eventAudit: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return tx;
}

function wireTransaction(tx: ReturnType<typeof makeTransaction>) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));
}

describe('registerEventCostPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records partial payments and settles the remaining balance using the same tenant-scoped lock', async () => {
    const state = makeEntryState();
    const tx = makeTransaction(state);
    wireTransaction(tx);

    const first = await registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', { idempotencyKey: '00000000-0000-4000-8000-000000000001', amount: 20, paymentMethod: 'CASH' });
    expect(first.status).toBe('PARTIALLY_PAID');
    expect(first.actualAmount).toBe(50);
    expect(tx.eventFinancialEntry.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ dueDate: new Date('2026-12-01T00:00:00.000Z') }) }));
    expect(tx.eventFinancialPayment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID', amount: new Prisma.Decimal(20) }) }));

    const replay = await registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', { idempotencyKey: '00000000-0000-4000-8000-000000000001', amount: 20, paymentMethod: 'CASH' });
    expect(replay.actualAmount).toBe(50);
    expect(tx.eventFinancialPayment.create).toHaveBeenCalledTimes(1);

    const second = await registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', { idempotencyKey: '00000000-0000-4000-8000-000000000002', amount: 50, paymentMethod: 'MANUAL_PIX' });
    expect(second.status).toBe('PAID');
    expect(second.actualAmount).toBe(100);
    expect(state.payments).toHaveLength(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
    expect(vi.mocked(prisma.$transaction).mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it.each([
    ['amount', { amount: 21 }],
    ['payment method', { paymentMethod: 'TRANSFER' }],
    ['notes', { notes: 'observação alterada' }],
    ['paidAt', { paidAt: new Date('2026-12-02T00:00:00.000Z') }],
  ])('rejects a retry with a different %s for the same cost payment key', async (_field, changes) => {
    const tx = makeTransaction(makeEntryState());
    wireTransaction(tx);
    const paidAt = new Date('2026-12-01T00:00:00.000Z');
    const input = {
      idempotencyKey: '00000000-0000-4000-8000-000000000008',
      amount: 20,
      paymentMethod: 'CASH' as const,
      paidAt,
      notes: 'Pagamento da primeira parte',
    };

    await registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', input);
    await expect(registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', {
      ...input,
      ...changes,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 });

    expect(tx.eventFinancialPayment.create).toHaveBeenCalledTimes(1);
  });

  it('rejects amounts above the current balance before inserting a ledger row', async () => {
    const tx = makeTransaction(makeEntryState());
    wireTransaction(tx);

    await expect(registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', { idempotencyKey: '00000000-0000-4000-8000-000000000003', amount: 71, paymentMethod: 'CASH' })).rejects.toMatchObject({ code: 'VALOR_ACIMA_DO_SALDO' });
    expect(tx.eventFinancialPayment.create).not.toHaveBeenCalled();
  });

  it('serializes the key before entry locking and rejects reuse against another entry', async () => {
    const tx = makeTransaction(makeEntryState());
    tx.eventFinancialPayment.findFirst.mockResolvedValueOnce({ id: 'payment-existing', financialEntryId: 'entry-other' } as never);
    wireTransaction(tx);

    await expect(registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', {
      idempotencyKey: '00000000-0000-4000-8000-000000000007', amount: 10, paymentMethod: 'CASH',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]!);
    expect(tx.eventFinancialPayment.create).not.toHaveBeenCalled();
  });

  it('records payments for generated costume procurement costs', async () => {
    const state = makeEntryState();
    state.originType = 'COSTUME';
    state.originId = 'costume-1';
    const tx = makeTransaction(state);
    wireTransaction(tx);

    const result = await registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', {
      idempotencyKey: '00000000-0000-4000-8000-000000000005',
      amount: 20,
      paymentMethod: 'TRANSFER',
    });

    expect(result.status).toBe('PARTIALLY_PAID');
    expect(result.actualAmount).toBe(50);
    expect(tx.eventFinancialPayment.create).toHaveBeenCalledTimes(1);
  });

  it('does not allow payment registration for costume loss entries', async () => {
    const state = makeEntryState();
    state.originType = 'COSTUME';
    state.originId = 'loss:assignment-1';
    const tx = makeTransaction(state);
    wireTransaction(tx);

    await expect(registerEventCostPayment({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', {
      idempotencyKey: '00000000-0000-4000-8000-000000000006',
      amount: 20,
      paymentMethod: 'TRANSFER',
    })).rejects.toMatchObject({ code: 'BAIXA_NAO_DISPONIVEL' });
    expect(tx.eventFinancialPayment.create).not.toHaveBeenCalled();
  });

  it('allows only a history-based refund for a costume procurement cost', async () => {
    const state = makeEntryState();
    state.originType = 'COSTUME';
    state.originId = 'costume-1';
    state.payments.push({
      id: 'payment-1',
      amount: new Prisma.Decimal(30),
      paidAt: new Date('2026-12-01T00:00:00.000Z'),
      paymentMethod: 'CASH',
      notes: null,
      refundedAmount: new Prisma.Decimal(0),
      status: 'PAID',
    });
    const tx = makeTransaction(state);
    wireTransaction(tx);

    const result = await updateFinancialEntry({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1', {
      status: 'REFUNDED',
      actualAmount: 30,
      refundedAmount: 30,
    });

    expect(result.status).toBe('REFUNDED');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.eventFinancialEntry.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.eventFinancialPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment-1', contaId: 'conta-a', financialEntryId: 'entry-1' },
      data: expect.objectContaining({ status: 'REFUNDED', refundedAmount: new Prisma.Decimal(30) }),
    }));
  });

  it('returns not found for an entry outside the authenticated tenant', async () => {
    const tx = makeTransaction(makeEntryState());
    tx.$queryRaw.mockResolvedValueOnce([]);
    wireTransaction(tx);

    await expect(registerEventCostPayment({ contaId: 'conta-b', userId: 'user-1' }, 'entry-1', { idempotencyKey: '00000000-0000-4000-8000-000000000004', amount: 10, paymentMethod: 'CASH' })).rejects.toThrow('Lançamento não encontrado.');
    expect(tx.eventFinancialPayment.create).not.toHaveBeenCalled();
  });
});

describe('deleteEventCost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('audits and hard deletes an empty manual cost under the tenant-scoped row lock', async () => {
    const state = makeEntryState();
    state.actual = 0;
    state.status = 'EXPECTED';
    const tx = makeTransaction(state);
    wireTransaction(tx);

    await expect(deleteEventCost({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1')).resolves.toEqual({ success: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.eventAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'events.finance.cost.delete', entityId: 'entry-1' }) }));
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.eventFinancialEntry.deleteMany).toHaveBeenCalledWith({ where: { id: 'entry-1', contaId: 'conta-a' } });
  });

  it.each([
    ['manual and empty', (state: ReturnType<typeof makeEntryState>) => { state.actual = 0; state.status = 'EXPECTED'; }],
    ['automatically generated from costume', (state: ReturnType<typeof makeEntryState>) => { state.actual = 0; state.status = 'PENDING'; state.originType = 'COSTUME'; state.originId = 'costume-1'; }],
    ['paid with full ledger', (state: ReturnType<typeof makeEntryState>) => { state.status = 'PAID'; state.payments.push({ id: 'payment-1', amount: new Prisma.Decimal(100), refundedAmount: new Prisma.Decimal(0), status: 'PAID' }); }],
    ['partially paid with ledger', (state: ReturnType<typeof makeEntryState>) => { state.payments.push({ id: 'payment-1', amount: new Prisma.Decimal(30), refundedAmount: new Prisma.Decimal(0), status: 'PAID' }); }],
    ['refunded with ledger', (state: ReturnType<typeof makeEntryState>) => { state.status = 'REFUNDED'; state.payments.push({ id: 'payment-1', amount: new Prisma.Decimal(30), refundedAmount: new Prisma.Decimal(30), status: 'REFUNDED' }); }],
    ['Asaas link', (state: ReturnType<typeof makeEntryState>) => { state.actual = 0; state.status = 'PENDING'; state.paymentProvider = 'ASAAS'; state.asaasPaymentId = 'pay-asaas-1'; state.paymentStatus = 'PENDING'; }],
  ])('hard-deletes a %s cost and preserves its complete pre-delete history in audit', async (_reason, prepare) => {
    const state = makeEntryState();
    prepare(state);
    const tx = makeTransaction(state);
    wireTransaction(tx);

    await expect(deleteEventCost({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1')).resolves.toEqual({ success: true });
    const auditData = vi.mocked(tx.eventAudit.create).mock.calls[0]?.[0].data as { before: { entry: { id: string }; payments: Array<{ id: string; amount: string }> ; asaasReference: { asaasPaymentId: string | null } } };
    expect(auditData.before.entry.id).toBe('entry-1');
    expect(auditData.before.payments).toHaveLength(state.payments.length);
    expect(auditData.before.payments[0]?.id).toBe(state.payments[0]?.id);
    expect(auditData.before.asaasReference.asaasPaymentId).toBe(state.asaasPaymentId);
    expect(tx.eventFinancialEntry.deleteMany).toHaveBeenCalledWith({ where: { id: 'entry-1', contaId: 'conta-a' } });
  });

  it('does not find an entry from another tenant', async () => {
    const tx = makeTransaction(makeEntryState());
    tx.$queryRaw.mockResolvedValueOnce([]);
    wireTransaction(tx);

    await expect(deleteEventCost({ contaId: 'conta-b', userId: 'user-1' }, 'entry-1')).rejects.toMatchObject({ status: 404 });
    expect(tx.eventFinancialEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('takes the shared source lock before deleting a costume loss cost', async () => {
    const state = makeEntryState();
    state.originType = 'COSTUME';
    state.originId = 'loss:assignment-1';
    const tx = makeTransaction(state);
    wireTransaction(tx);

    await deleteEventCost({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]!);
  });

  it('keeps the entry when audit persistence fails', async () => {
    const state = makeEntryState();
    state.actual = 0;
    state.status = 'EXPECTED';
    const tx = makeTransaction(state);
    tx.eventAudit.create.mockRejectedValueOnce(new Error('audit unavailable'));
    wireTransaction(tx);

    await expect(deleteEventCost({ contaId: 'conta-a', userId: 'user-1' }, 'entry-1')).rejects.toThrow('audit unavailable');
    expect(tx.eventFinancialEntry.deleteMany).not.toHaveBeenCalled();
  });
});
