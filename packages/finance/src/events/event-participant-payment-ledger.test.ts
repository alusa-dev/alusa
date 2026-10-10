import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@alusa/database', () => ({ prisma: { $transaction: vi.fn() } }));

import { prisma } from '@alusa/database';
import { createManualEventParticipantPayment, quitarEventParticipantFee } from './event-financial-operations';

function transaction() {
  const payments: Array<Record<string, any>> = [];
  const participant = {
    id: 'participant-1', contaId: 'conta-a', eventId: 'event-1', type: 'STUDENT', alunoId: 'student-1', turmaId: null,
    responsavelId: null, displayName: 'Ana', notes: null, registrationFeeCharged: new Prisma.Decimal(100),
    registrationFeeOriginal: new Prisma.Decimal(100), registrationFeeDiscount: new Prisma.Decimal(0),
    registrationFeeDiscountType: null, billingMode: 'FULL', entryAmount: new Prisma.Decimal(0), balanceAmount: new Prisma.Decimal(100),
    entryPaymentMethod: null, billingGroupId: null, registrationPaymentRules: null, isFeePaid: false, isFeeExempt: false,
    feePaymentMethod: null, revenueEntryId: 'entry-1', financialStatusSnapshot: 'PENDENTE', feePaidAmount: new Prisma.Decimal(0),
    feeRefundedAmount: new Prisma.Decimal(0), standaloneChargeId: null, asaasPaymentId: null, asaasInstallmentId: null,
    cancelledAt: null, cancelledReason: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date(),
    event: { id: 'event-1', status: 'ACTIVE' },
  };
  const secondParticipant = { ...participant, id: 'participant-2', revenueEntryId: 'entry-2' };
  const entry = {
    id: 'entry-1', contaId: 'conta-a', eventId: 'event-1', type: 'REVENUE', originType: 'EVENT_REGISTRATION',
    asaasPaymentId: null, paymentProvider: null, expectedAmount: new Prisma.Decimal(100), actualAmount: null,
    refundedAmount: new Prisma.Decimal(0), netAmount: null, dueDate: new Date(), status: 'PENDING',
  };
  const tx = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (_strings.join(' ').includes('pg_advisory_xact_lock')) return [];
      return [{ id: values[0] }];
    }),
    eventParticipant: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === 'participant-2' ? secondParticipant : participant),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(participant, data); return { count: 1 }; }),
    },
    eventFinancialEntry: {
      findFirst: vi.fn(async () => entry),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(entry, data); return { count: 1 }; }),
    },
    eventFinancialPayment: {
      findFirst: vi.fn(async ({ where }: { where: { idempotencyKey?: string } }) => payments.find((payment) => payment.idempotencyKey === where.idempotencyKey) ?? null),
      findMany: vi.fn(async () => payments),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const payment = { id: `payment-${payments.length + 1}`, ...data };
        payments.push(payment);
        return payment;
      }),
    },
    eventAudit: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    state: { payments, participant, secondParticipant, get entry() { return entry; } },
  };
  return tx;
}

function useTransaction(tx: ReturnType<typeof transaction>) {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));
}

describe('manual event participant payment ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locks the tenant-scoped participant before reading and recording a partial payment; an idempotent retry does not duplicate it', async () => {
    const tx = transaction();
    useTransaction(tx);
    const ctx = { contaId: 'conta-a', userId: 'user-1' };
    const input = { idempotencyKey: '00000000-0000-4000-8000-000000000101', amount: 30, paymentMethod: 'MANUAL_PIX' as const };

    const first = await createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', input);
    const retry = await createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', input);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.eventParticipant.findFirst.mock.invocationCallOrder[0]!);
    expect(first.totals.net).toBe(30);
    expect(retry.totals.net).toBe(30);
    expect(tx.state.payments).toHaveLength(1);
    expect(tx.state.entry).toMatchObject({ status: 'PARTIALLY_PAID', actualAmount: new Prisma.Decimal(30) });

    await expect(createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', {
      ...input,
      idempotencyKey: '00000000-0000-4000-8000-000000000103',
      amount: 80,
    })).rejects.toMatchObject({ code: 'VALOR_ACIMA_DO_SALDO' });
    expect(tx.state.payments).toHaveLength(1);
  });

  it('serializes the tenant idempotency key before target locks and rejects reuse for another participant', async () => {
    const tx = transaction();
    useTransaction(tx);
    const ctx = { contaId: 'conta-a', userId: 'user-1' };
    const input = { idempotencyKey: '00000000-0000-4000-8000-000000000105', amount: 20, paymentMethod: 'CASH' as const };

    await createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', input);
    await expect(createManualEventParticipantPayment(ctx, 'event-1', 'participant-2', input))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]!);
    expect(tx.state.payments).toHaveLength(1);
  });

  it('rejects idempotent retries with changed notes or explicitly supplied paidAt', async () => {
    const tx = transaction();
    useTransaction(tx);
    const ctx = { contaId: 'conta-a', userId: 'user-1' };
    const paidAt = new Date('2026-10-09T12:00:00.000Z');
    const input = { idempotencyKey: '00000000-0000-4000-8000-000000000106', amount: 20, paymentMethod: 'CASH' as const, notes: 'Parcela 1', paidAt };
    await createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', input);

    await expect(createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', { ...input, notes: 'Parcela diferente' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 });
    await expect(createManualEventParticipantPayment(ctx, 'event-1', 'participant-1', { ...input, paidAt: new Date(paidAt.getTime() + 1000) }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 });
    expect(tx.state.payments).toHaveLength(1);
  });

  it('records the remaining amount in the ledger when the legacy quit action settles a partial balance', async () => {
    const tx = transaction();
    // Existing partial payment from the same enrollment.
    tx.state.payments.push({
      id: 'payment-existing', contaId: 'conta-a', eventId: 'event-1', financialEntryId: 'entry-1', participantId: 'participant-1',
      amount: new Prisma.Decimal(25), refundedAmount: new Prisma.Decimal(0), netAmount: new Prisma.Decimal(25),
      status: 'RECEIVED', paymentMethod: 'CASH', paidAt: new Date(),
    });
    useTransaction(tx);

    const ctx = { contaId: 'conta-a', userId: 'user-1' };
    const input = {
      idempotencyKey: '00000000-0000-4000-8000-000000000102',
      paymentMethod: 'MANUAL_CASH',
    };
    await quitarEventParticipantFee(ctx, 'event-1', 'participant-1', input);
    await quitarEventParticipantFee(ctx, 'event-1', 'participant-1', input);

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]!);
    expect(tx.state.payments).toHaveLength(2);
    expect(tx.state.payments[1]).toMatchObject({ amount: new Prisma.Decimal(75), paymentMethod: 'CASH', idempotencyKey: '00000000-0000-4000-8000-000000000102' });
    expect(tx.state.entry).toMatchObject({ status: 'RECEIVED', actualAmount: new Prisma.Decimal(100) });
    expect(tx.state.participant).toMatchObject({ isFeePaid: true, feePaidAmount: new Prisma.Decimal(100) });
  });

  it('does not read participant or payment data when the row lock cannot find the authenticated tenant record', async () => {
    const tx = transaction();
    tx.$queryRaw.mockImplementation(async (_strings, ...values) => {
      if (_strings.join(' ').includes('pg_advisory_xact_lock')) return [] as never;
      return values.includes('conta-b') ? [] as never : [{ id: values[0] }] as never;
    });
    useTransaction(tx);

    await expect(createManualEventParticipantPayment({ contaId: 'conta-b', userId: 'user-2' }, 'event-1', 'participant-1', {
      idempotencyKey: '00000000-0000-4000-8000-000000000104',
      amount: 10,
      paymentMethod: 'CASH',
    })).rejects.toMatchObject({ code: 'INSCRICAO_NAO_ENCONTRADA' });
    expect(tx.eventParticipant.findFirst).not.toHaveBeenCalled();
    expect(tx.eventFinancialPayment.findFirst).not.toHaveBeenCalled();
  });
});
