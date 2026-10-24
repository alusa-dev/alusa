import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  runWithTenantMock,
  findAccessMock,
  verifyTicketMock,
  markTicketUsedMock,
  verifyTokenMock,
} = vi.hoisted(() => ({
  runWithTenantMock: vi.fn(),
  findAccessMock: vi.fn(),
  verifyTicketMock: vi.fn(),
  markTicketUsedMock: vi.fn(),
  verifyTokenMock: vi.fn(),
}));

vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));
vi.mock('@/src/server/events/event-ticket-scanner-access', () => ({ findPublicEventTicketScannerAccess: findAccessMock }));
vi.mock('@/src/server/events/event-ticket-scanner-token', () => ({
  verifyEventTicketScannerToken: verifyTokenMock,
}));
vi.mock('@alusa/lib/events/map/event-map.service', () => ({
  verifyEventMapTicketForCheckIn: verifyTicketMock,
  markEventMapTicketUsed: markTicketUsedMock,
}));

import { POST } from '../route';

const tx = { $queryRaw: vi.fn() };
const params = { params: Promise.resolve({ token: 'opaque-scanner-capability-token' }) };
const access = {
  id: 'access-a',
  contaId: 'conta-a',
  eventId: 'event-a',
  operatorName: 'Pessoa Externa',
  gateName: 'Portaria Leste',
  event: { id: 'event-a', contaId: 'conta-a', name: 'Evento A', status: 'ACTIVE' },
};

describe('public event ticket scanner route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 'access-a' }]);
    verifyTokenMock.mockReturnValue({ version: 1, accessId: 'access-a', contaId: 'conta-a' });
    findAccessMock.mockResolvedValue(access);
    runWithTenantMock.mockImplementation(async (_contaId: string, callback: (_db: typeof tx) => Promise<unknown>) => callback(tx));
    verifyTicketMock.mockResolvedValue({
      ticketId: 'internal-ticket-id',
      ticketCode: 'TICKET-1',
      status: 'VALID',
      usedAt: null,
      order: { id: 'internal-order-id', buyerName: 'Ana Souza', buyerEmail: 'ana@example.com', status: 'CONFIRMED', paymentStatus: 'PAID' },
      sale: null,
      seat: { sectionName: 'Pista', seatLabel: 'A-12', technicalCode: 'seat-secret' },
    });
    markTicketUsedMock.mockResolvedValue({
      ok: true,
      alreadyUsed: false,
      ticket: {
        ticketId: 'internal-ticket-id', ticketCode: 'TICKET-1', status: 'USED', usedAt: '2026-10-22T12:00:00.000Z',
        order: { id: 'internal-order-id', buyerName: 'Ana Souza', buyerEmail: 'ana@example.com', status: 'CONFIRMED', paymentStatus: 'PAID' },
        sale: null, seat: { sectionName: 'Pista', seatLabel: 'A-12', technicalCode: 'seat-secret' },
      },
    });
  });

  it('derives tenant and event only from the signed capability, ignoring forged request scope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/public/event-ticket-check-in/opaque-scanner-capability-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketCode: 'TICKET-1', confirm: false, contaId: 'conta-b', eventId: 'event-b' }),
    }), params);

    expect(response.status).toBe(200);
    expect(runWithTenantMock).toHaveBeenCalledWith('conta-a', expect.any(Function));
    expect(findAccessMock).toHaveBeenCalledWith(tx, { version: 1, accessId: 'access-a', contaId: 'conta-a' });
    expect(verifyTicketMock).toHaveBeenCalledWith('conta-a', 'event-a', 'TICKET-1', tx);
    expect(markTicketUsedMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({ data: {
      ticket: { ticketCode: 'TICKET-1', status: 'VALID', buyerName: 'Ana Souza', seat: { sectionName: 'Pista', seatLabel: 'A-12' } },
    } });
    expect(JSON.stringify(body)).not.toContain('ana@example.com');
    expect(JSON.stringify(body)).not.toContain('internal-ticket-id');
    expect(JSON.stringify(body)).not.toContain('internal-order-id');
    expect(JSON.stringify(body)).not.toContain('paymentStatus');
    expect(JSON.stringify(body)).not.toContain('seat-secret');
  });

  it('records operator and gate metadata when the external operator confirms a check-in', async () => {
    const response = await POST(new NextRequest('http://localhost/api/public/event-ticket-check-in/opaque-scanner-capability-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketCode: 'TICKET-1', confirm: true }),
    }), params);

    expect(response.status).toBe(200);
    expect(markTicketUsedMock).toHaveBeenCalledWith('conta-a', 'event-a', 'TICKET-1', null, {
      tx,
      operatorName: 'Pessoa Externa',
      gateName: 'Portaria Leste',
      scannerAccessId: 'access-a',
    });
    const body = await response.json();
    expect(body.data).toEqual({
      ok: true,
      alreadyUsed: false,
      ticket: {
        ticketCode: 'TICKET-1',
        status: 'USED',
        usedAt: '2026-10-22T12:00:00.000Z',
        buyerName: 'Ana Souza',
        seat: { sectionName: 'Pista', seatLabel: 'A-12' },
      },
    });
    expect(JSON.stringify(body)).not.toContain('ana@example.com');
  });

  it('rejects an invalid capability before opening a tenant transaction', async () => {
    verifyTokenMock.mockReturnValueOnce(null);
    const response = await POST(new NextRequest('http://localhost/api/public/event-ticket-check-in/opaque-scanner-capability-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketCode: 'TICKET-1' }),
    }), params);

    expect(response.status).toBe(404);
    expect(runWithTenantMock).not.toHaveBeenCalled();
  });

  it('rejects a revoked capability before confirming a ticket', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    const response = await POST(new NextRequest('http://localhost/api/public/event-ticket-check-in/opaque-scanner-capability-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketCode: 'TICKET-1', confirm: true }),
    }), params);

    expect(response.status).toBe(404);
    expect(markTicketUsedMock).not.toHaveBeenCalled();
    expect(findAccessMock).not.toHaveBeenCalled();
  });
});
