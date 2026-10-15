import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  schoolEvent: { findFirst: vi.fn() },
  eventParticipant: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  eventTicketSale: { findMany: vi.fn(), groupBy: vi.fn() },
  eventFinancialEntry: { groupBy: vi.fn(), findMany: vi.fn() },
  eventFinancialPayment: { groupBy: vi.fn() },
  eventTicketLot: { findMany: vi.fn() },
  eventMap: { findMany: vi.fn() },
  eventTicket: { count: vi.fn() },
}));

vi.mock('../prisma', () => ({ prisma: db }));

import { getEventReportDetail } from './event-report-detail.service';

describe('getEventReportDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.schoolEvent.findFirst.mockResolvedValue({ id: 'event-a', name: 'Mostra', startsAt: new Date('2026-10-01T12:00:00Z'), locationName: null, estimatedCapacity: 20, status: 'ACTIVE' });
    db.eventParticipant.count.mockResolvedValue(3);
    db.eventParticipant.aggregate.mockResolvedValue({ _count: { _all: 2 }, _sum: { registrationFeeOriginal: 100, registrationFeeDiscount: 20, registrationFeeCharged: 80, feePaidAmount: 80, feeRefundedAmount: 10 } });
    db.eventParticipant.findMany.mockResolvedValue([
      { type: 'STUDENT', revenueEntryId: 'entry-overdue', registrationFeeCharged: 100, feePaidAmount: 25, isFeeExempt: false, financialStatusSnapshot: null },
      { type: 'STUDENT', revenueEntryId: null, registrationFeeCharged: 40, feePaidAmount: 0, isFeeExempt: false, financialStatusSnapshot: null },
      { type: 'STUDENT', revenueEntryId: null, registrationFeeCharged: 0, feePaidAmount: 0, isFeeExempt: true, financialStatusSnapshot: 'ISENTO' },
      { type: 'STUDENT', revenueEntryId: null, registrationFeeCharged: 20, feePaidAmount: 20, isFeeExempt: false, financialStatusSnapshot: 'QUITADO' },
      { type: 'STUDENT', revenueEntryId: null, registrationFeeCharged: 35, feePaidAmount: 0, isFeePaid: true, isFeeExempt: false, financialStatusSnapshot: 'QUITADO' },
      { type: 'STUDENT', revenueEntryId: 'entry-cancelled', registrationFeeCharged: 50, feePaidAmount: 0, isFeeExempt: false, financialStatusSnapshot: null },
      { type: 'STUDENT', revenueEntryId: 'entry-partial-refund', registrationFeeCharged: 100, feePaidAmount: 100, isFeeExempt: false, financialStatusSnapshot: 'QUITADO' },
      { type: 'STUDENT', revenueEntryId: 'entry-refunded', registrationFeeCharged: 30, feePaidAmount: 0, isFeeExempt: false, financialStatusSnapshot: 'ESTORNADO' },
      { type: 'GUARDIAN', revenueEntryId: 'entry-nonstudent-cancelled', registrationFeeCharged: 60, feePaidAmount: 0, isFeeExempt: false, financialStatusSnapshot: null },
    ]);
    db.eventFinancialEntry.findMany.mockResolvedValue([
      { id: 'entry-overdue', dueDate: new Date('2020-01-01T00:00:00Z'), status: 'PENDING', actualAmount: 30, refundedAmount: 5, netAmount: 25 },
      { id: 'entry-cancelled', dueDate: new Date('2020-01-01T00:00:00Z'), status: 'CANCELLED', refundedAmount: 0 },
      { id: 'entry-partial-refund', dueDate: new Date('2020-01-01T00:00:00Z'), status: 'PARTIALLY_REFUNDED', actualAmount: 100, refundedAmount: 30, netAmount: 70 },
      { id: 'entry-refunded', dueDate: new Date('2020-01-01T00:00:00Z'), status: 'REFUNDED', refundedAmount: 30 },
      { id: 'entry-nonstudent-cancelled', dueDate: new Date('2020-01-01T00:00:00Z'), status: 'CANCELLED', refundedAmount: 0 },
    ]);
    db.eventParticipant.groupBy.mockResolvedValue([{ feePaymentMethod: 'PIX', _sum: { feePaidAmount: 80, feeRefundedAmount: 10 } }]);
    db.eventTicketSale.findMany.mockResolvedValue([
      { status: 'PAID', quantity: 2, lotId: 'lot-a', totalAmount: 100, refundedAmount: 20, paymentMethod: 'EXTERNAL_CARD', paidAt: new Date('2026-10-01T12:00:00Z'), eventMapOrderId: null },
      { status: 'REFUNDED', quantity: 1, lotId: 'lot-a', totalAmount: 50, refundedAmount: 0, paymentMethod: 'EXTERNAL_CARD', paidAt: null, eventMapOrderId: 'order-1' },
      { status: 'PENDING', quantity: 1, lotId: 'lot-a', totalAmount: 40, refundedAmount: 0, paymentMethod: 'MANUAL_PIX', paidAt: null, eventMapOrderId: null },
    ]);
    db.eventTicketSale.groupBy.mockResolvedValue([
      { status: 'PAID', _sum: { quantity: 2, totalAmount: 100, refundedAmount: 20 }, _count: { _all: 1 } },
      { status: 'REFUNDED', _sum: { quantity: 1, totalAmount: 50, refundedAmount: 0 }, _count: { _all: 1 } },
      { status: 'PENDING', _sum: { quantity: 1, totalAmount: 40, refundedAmount: 0 }, _count: { _all: 1 } },
    ]);
    db.eventFinancialEntry.groupBy.mockResolvedValue([
      { type: 'REVENUE', status: 'RECEIVED', category: 'Outro', originType: 'MANUAL', _sum: { expectedAmount: 50, actualAmount: 20, refundedAmount: 5, netAmount: 15 } },
      { type: 'REVENUE', status: 'PARTIALLY_REFUNDED', category: 'Estorno parcial', originType: 'MANUAL', _sum: { expectedAmount: 90, actualAmount: 90, refundedAmount: 30, netAmount: 60 } },
      { type: 'COST', status: 'PARTIALLY_PAID', category: 'Estrutura', originType: 'MANUAL', _sum: { expectedAmount: 30, actualAmount: 20, refundedAmount: 5, netAmount: 15 } },
      { type: 'COST', status: 'CANCELLED', category: 'Cancelado', originType: 'MANUAL', _sum: { expectedAmount: 70, actualAmount: 0, refundedAmount: 0, netAmount: 0 } },
      { type: 'COST', status: 'REFUNDED', category: 'Devolvido', originType: 'MANUAL', _sum: { expectedAmount: 90, actualAmount: 20, refundedAmount: 20, netAmount: 0 } },
      { type: 'REVENUE', status: 'RECEIVED', category: 'Ingresso', originType: 'TICKET_SALE', _sum: { expectedAmount: 100, actualAmount: 100, refundedAmount: 0, netAmount: 100 } },
    ]);
    db.eventFinancialPayment.groupBy.mockResolvedValue([{ paymentMethod: 'CASH', status: 'RECEIVED', _sum: { netAmount: 15, amount: 20, refundedAmount: 5 } }, { paymentMethod: 'PIX', status: 'RECEIVED', _sum: { netAmount: 70, amount: 80, refundedAmount: 10 } }, { paymentMethod: 'TRANSFER', status: 'REFUNDED', _sum: { netAmount: 0, amount: 5, refundedAmount: 5 } }]);
    db.eventTicketLot.findMany.mockResolvedValue([{ id: 'lot-a', name: 'Lote A', eventMapId: 'map-a', unitPrice: 20, quantityTotal: 5, quantitySold: 3 }]);
    db.eventMap.findMany.mockResolvedValue([{ id: 'map-a', name: 'Sessão 1', startsAt: new Date('2026-10-01T12:00:00Z') }]);
    db.eventTicket.count.mockResolvedValue(1);
  });

  it('scopes every read to the authenticated tenant and returns only aggregates/projections', async () => {
    const report = await getEventReportDetail('tenant-a', 'event-a');
    expect(report?.event).toMatchObject({ status: 'ACTIVE', estimatedCapacity: 20 });
    expect(report?.totals).toMatchObject({
      participants: 3, cancelledParticipants: 1, registrationCommitted: 295, registrationReceived: 150,
      activeStudentParticipants: 8, paidStudentParticipants: 2, pendingStudentParticipants: 1,
      overdueStudentParticipants: 2, exemptStudentParticipants: 1, closedStudentParticipants: 2,
      registrationRefunded: 10, committedRevenue: 525, receivedRevenue: 305, pendingCommittedRevenue: 220, resultRealized: 290, costsExpected: 30, costsRealized: 15,
      ticketReceivedGross: 150, ticketRefunded: 70, ticketReceivedNet: 80,
      ticketPendingRevenue: 40, otherRevenueExpected: 110, otherRevenueReceived: 75, otherRevenueRefunded: 35,
      ticketManualSales: 2, ticketOnlineSales: 1, availableTicketQuantity: 2, availableTicketPotential: 40,
      checkIns: 1, refundedRevenueExcludingTickets: 45,
    });
    expect(report?.payments).toEqual(expect.arrayContaining([
      { method: 'PIX', netReceived: 70 }, { method: 'EXTERNAL_CARD', netReceived: 80 }, { method: 'CASH', netReceived: 15 },
    ]));
    expect(report?.timeline).toEqual([{ day: '2026-10-01', amount: 80 }]);
    expect(report?.lots[0]).toMatchObject({ mapName: 'Sessão 1', sold: 3, total: 5 });
    expect(report?.categories).toContainEqual({ category: 'Estorno parcial', type: 'REVENUE', expected: 60, realized: 60 });
    expect(JSON.stringify(report)).not.toMatch(/buyerName|buyerEmail|buyerPhone|aluno|responsavel|displayName/i);

    expect(db.schoolEvent.findFirst.mock.calls[0][0].where).toEqual({ id: 'event-a', contaId: 'tenant-a' });
    for (const delegate of [db.eventParticipant.count, db.eventParticipant.aggregate, db.eventParticipant.findMany, db.eventTicketSale.findMany, db.eventTicketSale.groupBy, db.eventFinancialEntry.groupBy, db.eventFinancialPayment.groupBy, db.eventTicketLot.findMany, db.eventTicket.count]) {
      expect(delegate.mock.calls[0][0].where).toMatchObject({ contaId: 'tenant-a', eventId: 'event-a' });
    }
    expect(db.eventFinancialEntry.findMany.mock.calls[0][0].where).toMatchObject({ contaId: 'tenant-a', eventId: 'event-a' });
    expect(db.eventFinancialEntry.findMany.mock.calls[0][0].where.id.in).toEqual(expect.arrayContaining([
      'entry-overdue', 'entry-cancelled', 'entry-partial-refund', 'entry-refunded', 'entry-nonstudent-cancelled',
    ]));
    expect(db.eventFinancialEntry.findMany.mock.calls[0][0].select).toMatchObject({
      netAmount: true, actualAmount: true, refundedAmount: true,
    });
    expect(db.eventParticipant.findMany.mock.calls[0][0].select.isFeePaid).toBe(true);
    expect(db.eventMap.findMany.mock.calls[0][0].where).toMatchObject({ contaId: 'tenant-a', eventId: 'event-a', id: { in: ['map-a'] } });
    expect(db.eventTicketSale.findMany.mock.calls[0][0].select).not.toHaveProperty('buyerName');
    expect(db.eventTicketSale.findMany.mock.calls[0][0].select).not.toHaveProperty('lot');
    expect(db.eventFinancialPayment.groupBy.mock.calls[0][0].where.financialEntry).toEqual({ type: 'REVENUE', originType: { not: 'TICKET_SALE' } });
  });

  it('does not query event data when the selected id belongs to another tenant', async () => {
    db.schoolEvent.findFirst.mockResolvedValue(null);
    await expect(getEventReportDetail('tenant-a', 'event-from-tenant-b')).resolves.toBeNull();
    expect(db.eventTicketSale.findMany).not.toHaveBeenCalled();
    expect(db.schoolEvent.findFirst.mock.calls[0][0].where).toEqual({ id: 'event-from-tenant-b', contaId: 'tenant-a' });
  });
});
