import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, countMock, orderGroupByMock, ticketGroupByMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  orderGroupByMock: vi.fn(),
  ticketGroupByMock: vi.fn(),
}));

vi.mock('../../prisma', () => ({
  prisma: {
    eventMapOrder: {
      findMany: findManyMock,
      count: countMock,
      groupBy: orderGroupByMock,
    },
    eventTicket: { groupBy: ticketGroupByMock },
  },
}));

import { listEventPublicMapOrdersForAdmin } from './event-map.service';

describe('listEventPublicMapOrdersForAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([{
      id: 'order-1',
      buyerName: 'Ana Souza',
      buyerEmail: 'ana@example.test',
      totalAmount: 120,
      status: 'PAYMENT_PENDING',
      ticketFulfillmentStatus: 'PENDING',
      paymentMethod: 'PIX',
      paymentStatus: 'PENDING',
      asaasPaymentId: 'pay-1',
      invoiceUrl: 'https://asaas.test/invoice',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      expiresAt: new Date('2026-10-01T10:30:00.000Z'),
      confirmedAt: null,
      paidAt: null,
      map: { id: 'map-1', name: 'Mapa', publicSlug: 'festival' },
      reservation: { seats: [
        { id: 'seat-1', publicSeat: { lotName: '1º Lote' } },
        { id: 'seat-2', publicSeat: { lotName: '1º Lote' } },
      ] },
      items: [],
      tickets: [],
    }]);
    countMock.mockResolvedValue(20);
    orderGroupByMock.mockResolvedValue([
      { status: 'PAYMENT_PENDING', ticketFulfillmentStatus: 'PENDING', paymentStatus: 'PENDING', _count: { _all: 7 } },
      { status: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED', paymentStatus: 'RECEIVED', _count: { _all: 10 } },
      { status: 'CONFIRMED', ticketFulfillmentStatus: 'FAILED', paymentStatus: 'RECEIVED', _count: { _all: 1 } },
      { status: 'EXPIRED', ticketFulfillmentStatus: 'PENDING', paymentStatus: 'OVERDUE', _count: { _all: 2 } },
    ]);
    ticketGroupByMock.mockResolvedValue([
      { status: 'VALID', _count: { _all: 35 } },
      { status: 'USED', _count: { _all: 4 } },
      { status: 'CANCELLED', _count: { _all: 3 } },
    ]);
  });

  it('paginates tenant-scoped search results and counts reserved seats before ticket issuance', async () => {
    const result = await listEventPublicMapOrdersForAdmin('conta-1', 'event-1', {
      page: 2,
      pageSize: 6,
      search: ' Ana ',
      status: 'PAYMENT_PENDING',
    });

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1',
        eventId: 'event-1',
        status: 'PAYMENT_PENDING',
        OR: expect.arrayContaining([
          { buyerName: { contains: 'Ana', mode: 'insensitive' } },
          { buyerEmail: { contains: 'Ana', mode: 'insensitive' } },
        ]),
      }),
      skip: 6,
      take: 6,
    }));
    expect(countMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-1', eventId: 'event-1' }) }));
    expect(result.total).toBe(20);
    expect(result.items[0]).toMatchObject({ seatCount: 2, ticketCount: 0, lotNames: ['1º Lote'] });
  });

  it('returns distinct lot snapshots from order items even after the reservation is removed', async () => {
    findManyMock.mockResolvedValueOnce([{
      id: 'order-1',
      buyerName: 'Ana Souza',
      buyerEmail: 'ana@example.test',
      totalAmount: 120,
      status: 'CONFIRMED',
      ticketFulfillmentStatus: 'ISSUED',
      paymentMethod: 'PIX',
      paymentStatus: 'RECEIVED',
      asaasPaymentId: 'pay-1',
      invoiceUrl: 'https://asaas.test/invoice',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      expiresAt: null,
      confirmedAt: new Date('2026-10-01T10:05:00.000Z'),
      paidAt: new Date('2026-10-01T10:05:00.000Z'),
      map: { id: 'map-1', name: 'Sessão 02', publicSlug: 'festival' },
      reservation: null,
      items: [
        { id: 'item-1', publicSeat: { lotName: '1º Lote' } },
        { id: 'item-2', publicSeat: { lotName: '2º Lote' } },
        { id: 'item-3', publicSeat: { lotName: '1º Lote' } },
        { id: 'item-4', publicSeat: { lotName: null } },
        { id: 'item-5', publicSeat: { lotName: '  ' } },
      ],
      tickets: [],
    }]);

    const result = await listEventPublicMapOrdersForAdmin('conta-1', 'event-1');

    expect(result.items[0]).toMatchObject({
      map: { name: 'Sessão 02' },
      lotNames: ['1º Lote', '2º Lote'],
      seatCount: 5,
    });
  });

  it('returns full-event report counts without including cancelled tickets as issued', async () => {
    const result = await listEventPublicMapOrdersForAdmin('conta-1', 'event-1');

    expect(result.summary).toMatchObject({
      ordersTotal: 20,
      waitingPayment: 7,
      expired: 2,
      completed: 10,
      issuanceFailed: 1,
      ticketsIssued: 39,
      checkedIn: 4,
    });
    expect(ticketGroupByMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1', eventId: 'event-1', eventMapOrderId: { not: null } },
    }));
  });

  it('serializes cancelledAt for a cancelled order', async () => {
    const cancelledAt = new Date('2026-10-02T14:35:00.000Z');
    findManyMock.mockResolvedValueOnce([{
      id: 'order-cancelled',
      buyerName: 'Ana Souza',
      buyerEmail: 'ana@example.test',
      totalAmount: 120,
      status: 'CANCELLED',
      ticketFulfillmentStatus: 'PENDING',
      paymentMethod: 'PIX',
      paymentStatus: 'CANCELLED',
      asaasPaymentId: 'pay-1',
      invoiceUrl: 'https://asaas.test/invoice',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      expiresAt: null,
      confirmedAt: null,
      paidAt: null,
      refundedAt: null,
      cancelledAt,
      map: { id: 'map-1', name: 'Mapa', publicSlug: 'festival' },
      reservation: { seats: [{ id: 'seat-1', publicSeat: { lotName: null } }] },
      items: [],
      tickets: [],
    }]);

    const result = await listEventPublicMapOrdersForAdmin('conta-1', 'event-1', { status: 'CANCELLED' });

    expect(result.items[0]).toMatchObject({
      id: 'order-cancelled',
      status: 'CANCELLED',
      cancelledAt: '2026-10-02T14:35:00.000Z',
      lotNames: [],
    });
  });
});
