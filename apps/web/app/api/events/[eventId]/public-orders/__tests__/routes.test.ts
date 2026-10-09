import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { resolveTenantSessionMock, listOrdersMock, verifyTicketMock, markTicketUsedMock } = vi.hoisted(() => ({
  resolveTenantSessionMock: vi.fn(),
  listOrdersMock: vi.fn(),
  verifyTicketMock: vi.fn(),
  markTicketUsedMock: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@alusa/lib/events/map/event-map.service', () => ({
  listEventPublicMapOrdersForAdmin: listOrdersMock,
  verifyEventMapTicketForCheckIn: verifyTicketMock,
  markEventMapTicketUsed: markTicketUsedMock,
}));

import { GET } from '../route';
import { POST } from '../verify-ticket/route';

const params = { params: Promise.resolve({ eventId: 'event-1' }) };

describe('public order admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'ADMIN' });
    listOrdersMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 6 });
    verifyTicketMock.mockResolvedValue({ status: 'VALID', ticketCode: 'TICKET-1234' });
    markTicketUsedMock.mockResolvedValue({ status: 'USED', ticketCode: 'TICKET-1234' });
  });

  it('lista com query validada e escopo da conta autenticada', async () => {
    const response = await GET(new Request('http://localhost/api/events/event-1/public-orders?page=2&pageSize=10&search=Ana'), params);
    expect(response.status).toBe(200);
    expect(listOrdersMock).toHaveBeenCalledWith('conta-a', 'event-1', {
      page: 2, pageSize: 10, search: 'Ana', status: undefined,
    });
  });

  it('rejeita query inválida antes de consultar pedidos', async () => {
    const response = await GET(new Request('http://localhost/api/events/event-1/public-orders?page=0'), params);
    expect(response.status).toBe(422);
    expect(listOrdersMock).not.toHaveBeenCalled();
  });

  it('rejeita parâmetro de evento inválido antes de consultar pedidos', async () => {
    const response = await GET(new Request('http://localhost/api/events//public-orders'), {
      params: Promise.resolve({ eventId: ' ' }),
    });
    expect(response.status).toBe(422);
    expect(listOrdersMock).not.toHaveBeenCalled();
  });

  it('nega listagem sem permissão', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'PROFESSOR' });
    const response = await GET(new Request('http://localhost/api/events/event-1/public-orders'), params);
    expect(response.status).toBe(403);
    expect(listOrdersMock).not.toHaveBeenCalled();
  });

  it('valida e verifica ticket apenas no tenant autenticado', async () => {
    const response = await POST(new NextRequest('http://localhost/api/events/event-1/public-orders/verify-ticket', {
      method: 'POST', body: JSON.stringify({ ticketCode: 'TICKET-1234' }),
    }), params);
    expect(response.status).toBe(200);
    expect(verifyTicketMock).toHaveBeenCalledWith('conta-a', 'event-1', 'TICKET-1234');
  });

  it('rejeita payload inválido e nega check-in sem permissão', async () => {
    const invalid = await POST(new NextRequest('http://localhost/api/events/event-1/public-orders/verify-ticket', {
      method: 'POST', body: JSON.stringify({ ticketCode: 'x' }),
    }), params);
    expect(invalid.status).toBe(422);
    expect(verifyTicketMock).not.toHaveBeenCalled();

    resolveTenantSessionMock.mockResolvedValueOnce({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'PROFESSOR' });
    const forbidden = await POST(new NextRequest('http://localhost/api/events/event-1/public-orders/verify-ticket', {
      method: 'POST', body: JSON.stringify({ ticketCode: 'TICKET-1234', confirm: true }),
    }), params);
    expect(forbidden.status).toBe(403);
    expect(markTicketUsedMock).not.toHaveBeenCalled();
  });
});
