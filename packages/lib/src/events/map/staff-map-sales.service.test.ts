import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  eventTicketSale: { findFirst: vi.fn() },
}));

vi.mock('../../prisma', () => ({ prisma: prismaMock }));

import { getPublicStaffSaleTickets } from './staff-map-sales.service';

describe('staff sale ticket artwork DTO', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the persisted tenant and artwork storage key with public staff sale tickets', async () => {
    prismaMock.eventTicketSale.findFirst.mockResolvedValue({
      id: 'sale-1',
      status: 'PAID',
      buyerName: 'Responsável',
      totalAmount: 25,
      quantity: 1,
      saleSeats: [],
      tickets: [{ id: 'ticket-1', ticketCode: 'CODE-1', checkInCode: 'CHECK-1', status: 'VALID' }],
      event: {
        id: 'event-1',
        contaId: 'conta-1',
        name: 'Festival',
        startsAt: new Date('2026-11-14T20:00:00.000Z'),
        locationName: 'Auditório',
        locationAddress: null,
        ticketArtworkUrl: '/api/files/uploads/event-ticket-artwork/conta-1/event-1/artwork.jpg',
        ticketArtworkStorageKey: 'uploads/event-ticket-artwork/conta-1/event-1/artwork.jpg',
      },
      lot: { name: 'Pista' },
    });

    const tickets = await getPublicStaffSaleTickets('sale-1', 'access-token');

    expect(prismaMock.eventTicketSale.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sale-1', accessToken: 'access-token' },
      include: expect.objectContaining({
        event: { select: expect.objectContaining({ contaId: true, ticketArtworkStorageKey: true }) },
      }),
    }));
    expect(tickets.event).toMatchObject({
      id: 'event-1',
      contaId: 'conta-1',
      ticketArtworkUrl: '/api/files/uploads/event-ticket-artwork/conta-1/event-1/artwork.jpg',
      ticketArtworkStorageKey: 'uploads/event-ticket-artwork/conta-1/event-1/artwork.jpg',
    });
  });
});
