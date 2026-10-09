import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveTenantSessionMock, listCheckInsMock } = vi.hoisted(() => ({
  resolveTenantSessionMock: vi.fn(),
  listCheckInsMock: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@alusa/lib/events/ticket-checkin.service', () => ({ listEventTicketCheckIns: listCheckInsMock }));

import { GET } from '../route';

const params = { params: Promise.resolve({ eventId: 'event-a' }) };

describe('event check-in list route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'ADMIN' });
    listCheckInsMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('passes validated pagination and authenticated tenant to the reader', async () => {
    const response = await GET(new Request('http://localhost/api/events/event-a/check-ins?page=2&pageSize=25'), params);

    expect(response.status).toBe(200);
    expect(listCheckInsMock).toHaveBeenCalledWith('conta-a', 'event-a', { page: 2, pageSize: 25 });
  });

  it('rejects invalid pagination before reading check-ins', async () => {
    const response = await GET(new Request('http://localhost/api/events/event-a/check-ins?page=0'), params);

    expect(response.status).toBe(422);
    expect(listCheckInsMock).not.toHaveBeenCalled();

    const tooFar = await GET(new Request('http://localhost/api/events/event-a/check-ins?page=1001'), params);
    expect(tooFar.status).toBe(422);
    expect(listCheckInsMock).not.toHaveBeenCalled();
  });

  it('denies access without event ticket view permission', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'PROFESSOR' });

    const response = await GET(new Request('http://localhost/api/events/event-a/check-ins'), params);

    expect(response.status).toBe(403);
    expect(listCheckInsMock).not.toHaveBeenCalled();
  });
});
