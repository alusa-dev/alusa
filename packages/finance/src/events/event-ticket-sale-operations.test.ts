import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, emailEnqueue, whatsappEnqueue, audit } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    eventTicketSale: { findFirst: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
    eventTicketSaleSeat: { count: vi.fn() }, eventTicketLot: { findFirst: vi.fn() },
    eventTicket: { createMany: vi.fn() },
    eventFinancialEntry: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
  emailEnqueue: vi.fn(), whatsappEnqueue: vi.fn(), audit: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@alusa/lib/events/event-audit.service', () => ({ recordEventAudit: audit }));
vi.mock('@alusa/lib/events/event-participant-scope', () => ({ assertEventScopedTicketSaleLinks: vi.fn() }));
vi.mock('@alusa/lib/events/event-financial-read-models', () => ({
  mapTicketSale: (sale: unknown) => sale,
  mapFinancialEntry: (entry: unknown) => entry,
  eventParticipantScalarSelect: {},
}));
vi.mock('@alusa/lib/events/ticket-email-outbox', () => ({
  enqueueEventTicketEmail: emailEnqueue,
  buildPublicEventTicketSalePath: (id: string, token: string) => `/tickets/${id}?token=${token}`,
}));
vi.mock('@alusa/lib/events/ticket-whatsapp-notification', () => ({
  enqueueEventTicketWhatsAppNotification: whatsappEnqueue,
  EVENT_TICKET_WHATSAPP_CONSENT_VERSION: 'v1',
}));
vi.mock('@alusa/lib/events/map/event-map-order-operations', () => ({ syncPublicLotQuantity: vi.fn(), releaseSeatsForTicketSale: vi.fn() }));

import { updateTicketSale } from './event-ticket-sale-operations';

describe('updateTicketSale paid transition', () => {
  const accountId = 'conta-a';
  const current = {
    id: 'sale-a', contaId: accountId, eventId: 'event-a', lotId: 'lot-a', quantity: 2,
    status: 'PENDING', paymentMethod: 'MANUAL_PIX', buyerName: 'Pessoa', buyerEmail: ' Buyer@Example.com ',
    buyerPhone: '+5511999999999', whatsappOptInAt: new Date('2026-01-01'), whatsappOptInSource: 'STAFF_SALE',
    whatsappOptOutAt: null, accessToken: null, alunoId: null, responsavelId: null, revenueEntryId: null,
    totalAmount: 20, paidAt: null, cancelledAt: null, refundedAt: null, notes: null,
    lot: { id: 'lot-a', unitPrice: 10, name: 'Inteira', event: { status: 'ACTIVE', name: 'Evento', startsAt: new Date(), locationName: null, locationAddress: null } },
    event: { name: 'Evento', startsAt: new Date(), locationName: null, locationAddress: null },
    aluno: null, responsavel: null, tickets: [{ id: 'ticket-existing' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.eventTicketSale.findFirst.mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, status: 'PAID' })
      .mockResolvedValueOnce({ ...current, status: 'PAID' })
      .mockResolvedValueOnce({ ...current, status: 'PAID' })
      .mockResolvedValueOnce({ ...current, status: 'PAID' })
      .mockResolvedValueOnce({ ...current, status: 'PAID' });
    prismaMock.eventTicketSale.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.eventTicketSale.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    prismaMock.eventTicketSaleSeat.count.mockResolvedValue(0);
    prismaMock.eventFinancialEntry.create.mockResolvedValue({ id: 'entry-a' });
    prismaMock.eventTicket.createMany.mockResolvedValue({ count: 1 });
  });

  it('issues missing tickets, access token, email and opted-in WhatsApp notification transactionally', async () => {
    await updateTicketSale({ contaId: accountId, userId: 'user-a' }, 'sale-a', { status: 'PAID' } as never);

    expect(prismaMock.eventTicketSale.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sale-a', contaId: accountId, eventId: 'event-a' },
      data: expect.objectContaining({ status: 'PAID', accessToken: expect.stringMatching(/^sale_/) }),
    }));
    expect(prismaMock.eventTicket.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ contaId: accountId, eventId: 'event-a', eventTicketSaleId: 'sale-a' })],
    }));
    expect(emailEnqueue).toHaveBeenCalledWith(prismaMock, expect.objectContaining({ contaId: accountId, buyerEmail: 'buyer@example.com', ticketCount: 2 }));
    expect(whatsappEnqueue).toHaveBeenCalledWith(prismaMock, expect.objectContaining({ contaId: accountId, purchaseId: 'sale-a', recipientPhone: current.buyerPhone, consentSource: 'STAFF_SALE' }));
    expect(audit).toHaveBeenCalledWith(prismaMock, expect.objectContaining({ contaId: accountId, action: 'events.ticketSale.update', entityId: 'sale-a' }));
  });

  it('does not enqueue duplicate delivery effects when PAID is applied again', async () => {
    await updateTicketSale({ contaId: accountId, userId: 'user-a' }, 'sale-a', { status: 'PAID' } as never);
    await updateTicketSale({ contaId: accountId, userId: 'user-a' }, 'sale-a', { status: 'PAID' } as never);

    expect(whatsappEnqueue).toHaveBeenCalledTimes(1);
    expect(emailEnqueue).toHaveBeenCalledTimes(1);
    expect(prismaMock.eventTicket.createMany).toHaveBeenCalledTimes(1);
  });

  it('fails the paid transition when WhatsApp outbox persistence fails', async () => {
    prismaMock.eventTicketSale.findFirst.mockReset();
    prismaMock.eventTicketSale.findFirst.mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, status: 'PAID' })
      .mockResolvedValueOnce({ ...current, status: 'PAID' });
    whatsappEnqueue.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(updateTicketSale({ contaId: accountId, userId: 'user-a' }, 'sale-a', { status: 'PAID' } as never))
      .rejects.toThrow('outbox unavailable');
    expect(audit).not.toHaveBeenCalled();
  });

  it('does not queue WhatsApp when consent was withdrawn', async () => {
    prismaMock.eventTicketSale.findFirst.mockReset();
    prismaMock.eventTicketSale.findFirst.mockResolvedValueOnce({ ...current, whatsappOptOutAt: new Date() }).mockResolvedValueOnce({ ...current, status: 'PAID' }).mockResolvedValueOnce({ ...current, status: 'PAID' });

    await updateTicketSale({ contaId: accountId, userId: 'user-a' }, 'sale-a', { status: 'PAID' } as never);

    expect(whatsappEnqueue).not.toHaveBeenCalled();
  });
});
