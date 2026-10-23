import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { resolveTenantSessionMock, runWithTenantMock, listAccessesMock, createAccessMock } = vi.hoisted(() => ({
  resolveTenantSessionMock: vi.fn(),
  runWithTenantMock: vi.fn(),
  listAccessesMock: vi.fn(),
  createAccessMock: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));
vi.mock('@/src/server/events/event-ticket-scanner-access', () => ({
  listEventTicketScannerAccesses: listAccessesMock,
  createEventTicketScannerAccess: createAccessMock,
}));

import { GET, POST } from '../route';

const tx = {};
const params = { params: Promise.resolve({ eventId: 'event-a' }) };

describe('event ticket scanner access management route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'ADMIN' });
    runWithTenantMock.mockImplementation(async (contaId: string, callback: (_db: typeof tx) => Promise<unknown>) => callback(tx));
    listAccessesMock.mockResolvedValue({ items: [] });
    createAccessMock.mockResolvedValue({ id: 'access-a', token: 'signed-token' });
  });

  it('lists only through the authenticated tenant context', async () => {
    const response = await GET(new NextRequest('http://localhost/api/events/event-a/ticket-scanner-accesses'), params);

    expect(response.status).toBe(200);
    expect(runWithTenantMock).toHaveBeenCalledWith('conta-a', expect.any(Function));
    expect(listAccessesMock).toHaveBeenCalledWith(tx, 'conta-a', 'event-a');
  });

  it('ignores a forged tenant in the body and validates operator and gate fields', async () => {
    const response = await POST(new NextRequest('http://localhost/api/events/event-a/ticket-scanner-accesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName: 'Pessoa Externa', gateName: 'Portaria Norte', contaId: 'conta-b' }),
    }), params);

    expect(response.status).toBe(201);
    expect(createAccessMock).toHaveBeenCalledWith(tx, {
      contaId: 'conta-a',
      eventId: 'event-a',
      actorUserId: 'user-a',
      operatorName: 'Pessoa Externa',
      gateName: 'Portaria Norte',
    });

    createAccessMock.mockClear();
    const invalid = await POST(new NextRequest('http://localhost/api/events/event-a/ticket-scanner-accesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName: '', gateName: '' }),
    }), params);
    expect(invalid.status).toBe(422);
    expect(createAccessMock).not.toHaveBeenCalled();
  });
});
