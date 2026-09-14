import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({
  prisma: {
    eventTicket: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../prisma';
import {
  verifyEventTicketForCheckInAcrossEvents,
} from './ticket-checkin.service';

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    ticketCode: 'TICKET-123456789',
    status: 'VALID',
    usedAt: null,
    event: {
      id: 'event-1',
      name: 'Festival da escola',
      status: 'ACTIVE',
      startsAt: new Date('2026-09-20T18:00:00.000Z'),
    },
    order: null,
    orderItem: null,
    sale: null,
    saleSeat: null,
    ...overrides,
  };
}

describe('verifyEventTicketForCheckInAcrossEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifica o evento automaticamente pelo código completo dentro da conta', async () => {
    vi.mocked(prisma.eventTicket.findFirst).mockResolvedValue(ticket() as never);

    const result = await verifyEventTicketForCheckInAcrossEvents('conta-1', 'ticket-123456789');

    expect(prisma.eventTicket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1', ticketCode: 'TICKET-123456789' },
    }));
    expect(result.event).toEqual({
      id: 'event-1',
      name: 'Festival da escola',
      status: 'ACTIVE',
      startsAt: '2026-09-20T18:00:00.000Z',
    });
    expect(result.ticket.ticketId).toBe('ticket-1');
  });

  it('resolve códigos curtos legados sem exigir evento e rejeita colisões', async () => {
    vi.mocked(prisma.eventTicket.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ticket() as never);
    vi.mocked(prisma.eventTicket.findMany).mockResolvedValue([
      { id: 'ticket-1', eventId: 'event-1', ticketCode: 'TICKET-123456789' },
    ] as never);

    const result = await verifyEventTicketForCheckInAcrossEvents('conta-1', '23456789');

    expect(prisma.eventTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1' },
    }));
    expect(result.event.id).toBe('event-1');

    vi.clearAllMocks();
    vi.mocked(prisma.eventTicket.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.eventTicket.findMany).mockResolvedValue([
      { id: 'ticket-1', eventId: 'event-1', ticketCode: 'TICKET-123456789' },
      { id: 'ticket-2', eventId: 'event-2', ticketCode: 'OTHER-123456789' },
    ] as never);

    await expect(verifyEventTicketForCheckInAcrossEvents('conta-1', '23456789')).rejects.toMatchObject({
      code: 'CODIGO_AMBIGUO',
    });
  });
});
