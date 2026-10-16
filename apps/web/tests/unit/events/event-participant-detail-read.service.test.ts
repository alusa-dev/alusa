import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  eventParticipant: { findFirst: vi.fn() },
  consentRecord: { findMany: vi.fn() },
  eventCostumeAssignment: { findMany: vi.fn() },
  eventTicketSale: { findMany: vi.fn() },
  eventMapOrder: { findMany: vi.fn() },
  eventFinancialEntry: { findMany: vi.fn() },
  eventFinancialPayment: { findMany: vi.fn() },
  standaloneInstallmentPlan: { findMany: vi.fn() },
  charge: { findMany: vi.fn() },
}));

vi.mock('@/src/server/events/event-participant.repository', () => ({ eventParticipantRepository: db }));
vi.mock('@alusa/lib/events/event-contracts.service', () => ({ listEventContractsByStudent: vi.fn().mockResolvedValue([]) }));

import { getEventParticipantDetail } from '@/src/server/events/event-participant-detail-read.service';

describe('getEventParticipantDetail ticket metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.eventParticipant.findFirst.mockResolvedValue({
      id: 'participant-1',
      contaId: 'conta-a',
      eventId: 'event-1',
      alunoId: 'student-1',
      responsavelId: null,
      revenueEntryId: null,
      asaasPaymentId: null,
      asaasInstallmentId: null,
      isFeePaid: false,
      isFeeExempt: false,
      registrationFeeCharged: { toNumber: () => 100 },
      registrationFeeOriginal: { toNumber: () => 100 },
      registrationFeeDiscount: { toNumber: () => 0 },
      registrationFeeDiscountType: null,
      aluno: { id: 'student-1', email: 'student@example.invalid' },
      responsavel: null,
      event: {},
      turma: null,
    });
    db.consentRecord.findMany.mockResolvedValue([]);
    db.eventCostumeAssignment.findMany.mockResolvedValue([]);
    db.eventTicketSale.findMany.mockResolvedValue([]);
    db.eventMapOrder.findMany.mockResolvedValue([{
      id: 'order-partial',
      status: 'PARTIALLY_REFUNDED',
      totalAmount: 150,
      refundedAmount: 30,
      buyerName: 'Ana',
      paymentMethod: 'PIX',
      createdAt: new Date('2026-10-14T12:00:00.000Z'),
      paidAt: new Date('2026-10-14T12:05:00.000Z'),
      confirmedAt: null,
      asaasPaymentId: null,
      paymentStatus: 'REFUNDED',
      invoiceUrl: null,
      ticketFulfillmentStatus: 'ISSUED',
      reservation: null,
      items: [
        { publicSeat: { lotId: 'lot-1', lotName: 'Lote A' }, ticket: { id: 'ticket-1', status: 'VALID' } },
        { publicSeat: { lotId: 'lot-1', lotName: 'Lote A' }, ticket: { id: 'ticket-2', status: 'VALID' } },
      ],
    }]);
    db.eventFinancialEntry.findMany.mockResolvedValue([]);
    db.eventFinancialPayment.findMany.mockResolvedValue([]);
    db.standaloneInstallmentPlan.findMany.mockResolvedValue([]);
    db.charge.findMany.mockResolvedValue([]);
  });

  it('keeps partially refunded public order tickets sold and reports net ticket spend', async () => {
    const result = await getEventParticipantDetail({
      ctx: { contaId: 'conta-a', userId: 'user-a' },
      eventId: 'event-1',
      participantId: 'participant-1',
    });

    expect(result.found).toBe(true);
    if (!result.found) return;
    const data = result.data as { participant: { metrics: unknown }; ticketSales: Array<{ status: string; refundedAmount: number }> };
    expect(data.participant.metrics).toMatchObject({ ticketsBought: 2, ticketsValue: 120, totalSpent: 220 });
    expect(data.ticketSales[0]).toMatchObject({ status: 'PAID', refundedAmount: 30 });
  });
});
