import { describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({ prisma: {} }));

import { assertEventTicketSalesOpen } from './events.service';

describe('event ticket sales lifecycle', () => {
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
