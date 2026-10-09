import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({
  prisma: {
    eventTicket: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    eventAudit: { findMany: vi.fn() },
  },
}));

import { prisma } from '../prisma';
import {
  assertEventAllowsCheckIn,
  listEventTicketCheckIns,
  isEventMapOrderRefundFinalized,
  isTicketPaymentBlocked,
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
    vi.mocked(prisma.eventTicket.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.eventTicket.findMany).mockResolvedValue([
      { id: 'ticket-1', eventId: 'event-1', ticketCode: 'TICKET-123456789' },
      { id: 'ticket-2', eventId: 'event-2', ticketCode: 'OTHER-123456789' },
    ] as never);

    await expect(verifyEventTicketForCheckInAcrossEvents('conta-1', '23456789')).rejects.toMatchObject({
      code: 'CODIGO_AMBIGUO',
    });
  });

  it('resolve o novo código curto diretamente e aceita a versão formatada', async () => {
    vi.mocked(prisma.eventTicket.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ticket({ checkInCode: '01AB23CD45EF' }) as never);

    const result = await verifyEventTicketForCheckInAcrossEvents('conta-1', '01AB-23CD-45EF');

    expect(prisma.eventTicket.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { contaId: 'conta-1', checkInCode: '01AB23CD45EF' },
    }));
    expect(prisma.eventTicket.findMany).not.toHaveBeenCalled();
    expect(result.event.id).toBe('event-1');
  });
});

describe('listEventTicketCheckIns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only USED tickets scoped to tenant and event, with the recorded operator', async () => {
    vi.mocked(prisma.eventTicket.findMany).mockResolvedValue([{
      id: 'ticket-used',
      usedAt: new Date('2026-10-08T16:00:00.000Z'),
      order: { buyerName: 'Ana', buyerEmail: 'ana@example.test', map: { name: 'Sessão 1' } },
      orderItem: { sectionName: 'Plateia', seatLabel: 'A1' },
      sale: null,
      saleSeat: null,
    }] as never);
    vi.mocked(prisma.eventAudit.findMany).mockResolvedValue([{
      entityId: 'ticket-used', actor: { nome: 'Operador' },
    }] as never);
    vi.mocked(prisma.eventTicket.count).mockResolvedValue(41);

    const result = await listEventTicketCheckIns('conta-a', 'event-a', { page: 3, pageSize: 10 });

    expect(prisma.eventTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', eventId: 'event-a', status: 'USED' },
      skip: 20,
      take: 10,
    }));
    expect(prisma.eventTicket.count).toHaveBeenCalledWith({ where: { contaId: 'conta-a', eventId: 'event-a', status: 'USED' } });
    expect(prisma.eventAudit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', eventId: 'event-a', entityId: { in: ['ticket-used'] } }),
    }));
    expect(result).toMatchObject({ total: 41, page: 3, pageSize: 10 });
    expect(result.items[0]).toMatchObject({
      buyerName: 'Ana', sessionName: 'Sessão 1', seatLabel: 'Plateia · A1', operatorName: 'Operador',
    });
  });

  it('clamps page and page size and skips the audit lookup for an empty page', async () => {
    vi.mocked(prisma.eventTicket.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.eventTicket.count).mockResolvedValue(3);

    const result = await listEventTicketCheckIns('conta-a', 'event-a', { page: 1001, pageSize: 1000 });

    expect(prisma.eventTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 49_950, take: 50 }));
    expect(result).toMatchObject({ items: [], total: 3, page: 1_000, pageSize: 50 });
    expect(prisma.eventAudit.findMany).not.toHaveBeenCalled();
  });
});

describe('event-map refund finality', () => {
  it('keeps a confirmed refund terminal across later payment snapshots', () => {
    expect(isEventMapOrderRefundFinalized('REFUNDED', 'REFUNDED')).toBe(true);
    expect(isEventMapOrderRefundFinalized('CONFIRMED', 'PAYMENT_REFUNDED')).toBe(true);
    expect(isEventMapOrderRefundFinalized('CONFIRMED', 'REFUND_DENIED')).toBe(false);
    expect(isEventMapOrderRefundFinalized('CONFIRMED', 'DISPUTE_LOST')).toBe(false);
  });
});

describe('assertEventAllowsCheckIn', () => {
  it.each(['DRAFT', 'PLANNING', 'ACTIVE', 'FINISHED'] as const)('allows check-in for %s events', (status) => {
    expect(() => assertEventAllowsCheckIn(status)).not.toThrow();
  });

  it.each(['CANCELLED', 'ARCHIVED'] as const)('rejects check-in for %s events', (status) => {
    expect(() => assertEventAllowsCheckIn(status)).toThrow(expect.objectContaining({
      code: 'EVENTO_INDISPONIVEL',
      status: 409,
    }));
  });
});

describe('isTicketPaymentBlocked', () => {
  it.each([
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PAYMENT_REFUND_IN_PROGRESS',
    'REFUNDED',
    'PAYMENT_REFUNDED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
    'CHARGEBACK_UNKNOWN',
  ])('blocks tickets while payment is %s', (status) => {
    expect(isTicketPaymentBlocked(status)).toBe(true);
  });

  it.each(['RECEIVED', 'REFUND_DENIED', 'PENDING', null, undefined])('keeps tickets unblocked for %s', (status) => {
    expect(isTicketPaymentBlocked(status)).toBe(false);
  });
});
