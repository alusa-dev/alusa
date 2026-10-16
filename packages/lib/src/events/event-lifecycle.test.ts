import { describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({ prisma: {} }));

import { assertEventTicketSalesOpen, mapTicketLot } from './events.service';

describe('event ticket sales lifecycle', () => {
  it('expõe disponibilidade apenas para lotes ACTIVE', () => {
    const inactiveStatuses = ['DRAFT', 'CLOSED', 'CANCELLED', 'ARCHIVED', 'SOLD_OUT'] as const;
    const makeLot = (status: 'ACTIVE' | (typeof inactiveStatuses)[number]) => ({
      id: 'lot-a', contaId: 'tenant-a', eventId: 'event-a', eventMapId: null,
      eventMap: null,
      event: { id: 'event-a', name: 'Mostra', startsAt: new Date('2026-10-01T12:00:00Z') },
      name: 'Lote', ticketType: 'GENERAL', unitPrice: 10, quantityTotal: 10, quantitySold: 3,
      saleStartsAt: null, saleEndsAt: null, status, notes: null,
      createdAt: new Date('2026-09-01T12:00:00Z'), updatedAt: new Date('2026-09-01T12:00:00Z'),
    }) as Parameters<typeof mapTicketLot>[0];

    expect(mapTicketLot(makeLot('ACTIVE')).quantityAvailable).toBe(7);
    for (const status of inactiveStatuses) {
      expect(mapTicketLot(makeLot(status)).quantityAvailable).toBe(0);
    }
  });

  it('permite venda enquanto o evento ainda não foi finalizado', () => {
    expect(() => assertEventTicketSalesOpen({ status: 'ACTIVE', finishedAt: null })).not.toThrow();
  });

  it('mantém novas vendas bloqueadas depois de reativar um evento finalizado', () => {
    expect(() => assertEventTicketSalesOpen({
      status: 'ACTIVE',
      finishedAt: new Date('2026-09-13T18:00:00.000Z'),
    })).toThrowError(expect.objectContaining({
      code: 'VENDAS_INGRESSOS_ENCERRADAS',
      status: 409,
    }));
  });

  it('bloqueia a venda enquanto o evento está finalizado', () => {
    expect(() => assertEventTicketSalesOpen({ status: 'FINISHED', finishedAt: new Date() })).toThrowError(expect.objectContaining({
      code: 'EVENTO_BLOQUEADO',
      status: 409,
    }));
  });
});
