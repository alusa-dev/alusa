import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../prisma', () => ({
  prisma: {
    eventParticipant: { count: vi.fn(), findMany: vi.fn() },
    eventFinancialEntry: { findMany: vi.fn() },
    eventFinancialPayment: { findMany: vi.fn() },
    eventBillingGroup: { findMany: vi.fn() },
    standaloneInstallmentPlan: { findMany: vi.fn() },
    charge: { findMany: vi.fn() },
    eventCostumeAssignment: { findMany: vi.fn() },
    eventTicketSale: { findMany: vi.fn() },
  },
}));

import { prisma } from '../prisma';
import { applyParticipantPaymentSnapshotsToEntries, financialEntryStatusFromParticipantStatus, listEventParticipants, listEventParticipantsPage } from './events.service';

const participant = (overrides: Record<string, unknown> = {}) => ({
  id: 'participant-1', contaId: 'conta-a', eventId: 'event-1', type: 'STUDENT', alunoId: 'student-1', turmaId: null,
  responsavelId: null, displayName: null, notes: null, registrationFeeCharged: new Prisma.Decimal(100), registrationFeeOriginal: new Prisma.Decimal(100),
  registrationFeeDiscount: new Prisma.Decimal(0), registrationFeeDiscountType: null, billingMode: 'FULL', entryAmount: new Prisma.Decimal(0), balanceAmount: new Prisma.Decimal(100),
  entryPaymentMethod: null, billingGroupId: null, registrationPaymentRules: null, isFeePaid: true, isFeeExempt: false,
  feePaymentMethod: 'MANUAL_PIX', revenueEntryId: null, financialStatusSnapshot: 'QUITADO', feePaidAmount: new Prisma.Decimal(0),
  feeRefundedAmount: new Prisma.Decimal(0), standaloneChargeId: null, asaasPaymentId: 'asaas-payment-1', asaasInstallmentId: null,
  cancelledAt: null, cancelledReason: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date(),
  aluno: { id: 'student-1', nome: 'Ana', foto: null, email: null }, responsavel: null, turma: null,
  ...overrides,
});

describe('event participant read models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.eventBillingGroup.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.eventFinancialPayment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.eventFinancialEntry.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.eventCostumeAssignment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.eventTicketSale.findMany).mockResolvedValue([] as never);
  });

  it('applies an EM_DIA payment snapshot as a partially paid financial entry', () => {
    expect(financialEntryStatusFromParticipantStatus('EM_DIA')).toBe('PARTIALLY_PAID');
    expect(financialEntryStatusFromParticipantStatus('PARCIAL')).toBe('PARTIALLY_PAID');
    const entries = applyParticipantPaymentSnapshotsToEntries([{
      id: 'entry-1', status: 'PENDING', actualAmount: null,
    }], new Map([['entry-1', {
      percentPaid: 40,
      financialStatus: 'EM_DIA',
      totalPaid: 40,
      totalRefunded: 0,
      netPaid: 40,
      realizedAt: new Date('2026-10-09T12:00:00.000Z'),
      entryStatus: 'PARTIALLY_PAID',
    }]]));

    expect(entries[0]).toMatchObject({ status: 'PARTIALLY_PAID', actualAmount: new Prisma.Decimal(40), netAmount: new Prisma.Decimal(40) });
  });

  it('uses the canonical Asaas payment snapshot for paged mobile results even when participant snapshots are stale', async () => {
    vi.mocked(prisma.eventParticipant.count).mockResolvedValue(1);
    vi.mocked(prisma.eventParticipant.findMany).mockResolvedValue([participant() as never] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([{
      id: 'charge-1', contaId: 'conta-a', asaasPaymentId: 'asaas-payment-1', standaloneInstallmentPlanId: null,
      status: 'RECEIVED', value: 100, paidValue: 100, refundedValue: 0, statusUpdatedAt: new Date(),
    }] as never);

    const page = await listEventParticipantsPage({ contaId: 'conta-a' }, 'event-1');

    expect(page.participants[0]).toMatchObject({ feePaidAmount: 100, percentPaid: 100, financialStatus: 'QUITADO' });
    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-a' }) }));
  });

  it('keeps partial ledger payments and refunds equivalent in full and paginated participant read models', async () => {
    const row = participant({
      isFeePaid: false,
      revenueEntryId: 'entry-registration-1',
      asaasPaymentId: null,
      financialStatusSnapshot: 'PENDENTE',
    });
    vi.mocked(prisma.eventParticipant.findMany).mockResolvedValue([row as never] as never);
    vi.mocked(prisma.eventParticipant.count).mockResolvedValue(1);
    vi.mocked(prisma.eventFinancialEntry.findMany).mockResolvedValue([{
      id: 'entry-registration-1',
      contaId: 'conta-a',
      eventId: 'event-1',
      asaasPaymentId: null,
      status: 'PARTIALLY_PAID',
      actualAmount: new Prisma.Decimal(90),
      refundedAmount: new Prisma.Decimal(10),
      realizedAt: new Date('2026-10-09T12:00:00.000Z'),
    }] as never);
    vi.mocked(prisma.eventFinancialPayment.findMany).mockResolvedValue([
      { financialEntryId: 'entry-registration-1', status: 'RECEIVED', amount: new Prisma.Decimal(60), refundedAmount: new Prisma.Decimal(10) },
      { financialEntryId: 'entry-registration-1', status: 'RECEIVED', amount: new Prisma.Decimal(30), refundedAmount: new Prisma.Decimal(0) },
    ] as never);

    const full = await listEventParticipants({ contaId: 'conta-a' }, 'event-1');
    const page = await listEventParticipantsPage({ contaId: 'conta-a' }, 'event-1');

    expect(full[0]).toMatchObject({ totalPaid: 90, totalRefunded: 10, netPaid: 80, percentPaid: 80, financialStatus: 'EM_DIA' });
    expect(page.participants[0]).toMatchObject({ feePaidAmount: 80, percentPaid: 80, financialStatus: 'EM_DIA' });
  });

  it('loads costume assignments and ticket sales in batches for the full participant list', async () => {
    vi.mocked(prisma.eventParticipant.findMany).mockResolvedValue([
      participant() as never,
      participant({ id: 'participant-2', alunoId: 'student-2', aluno: { id: 'student-2', nome: 'Bia', foto: null, email: null }, asaasPaymentId: null, isFeePaid: false }) as never,
    ] as never);

    await listEventParticipants({ contaId: 'conta-a' }, 'event-1');

    expect(prisma.eventCostumeAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eventTicketSale.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eventCostumeAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', eventId: 'event-1', alunoId: { in: ['student-1', 'student-2'] } }),
    }));
  });
});
