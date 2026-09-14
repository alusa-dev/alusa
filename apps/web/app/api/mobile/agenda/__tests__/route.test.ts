import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../route';

const { verifyMobileAccessToken, listMobileAgendaEvents, createMobileAgendaEvent, knownMobileAgendaError } = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  listMobileAgendaEvents: vi.fn(),
  createMobileAgendaEvent: vi.fn(),
  knownMobileAgendaError: vi.fn(() => null),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/features/aulas/server/mobile-agenda.service', () => ({
  listMobileAgendaEvents,
  createMobileAgendaEvent,
  MobileAgendaUnauthorizedError: class MobileAgendaUnauthorizedError extends Error {},
  MobileAgendaForbiddenError: class MobileAgendaForbiddenError extends Error {},
  MobileAgendaNotFoundError: class MobileAgendaNotFoundError extends Error {},
}));
vi.mock('@/features/aulas/server/mobile-agenda-route-utils', () => ({ knownMobileAgendaError }));

function request(path: string, init?: Omit<RequestInit, 'signal'>, token = 'access-token') {
  return new NextRequest(`http://localhost:3000${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

describe('mobile agenda routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recusa listagem sem token válido', async () => {
    verifyMobileAccessToken.mockResolvedValue(null);

    const response = await GET(request('/api/mobile/agenda', undefined, ''));

    expect(response.status).toBe(401);
    expect(listMobileAgendaEvents).not.toHaveBeenCalled();
  });

  it('valida o período e encaminha a consulta para a conta do token', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    listMobileAgendaEvents.mockResolvedValue({ success: true, data: { events: [] } });

    const response = await GET(request('/api/mobile/agenda?start=2026-09-13T00:00:00.000Z&end=2026-09-19T23:59:59.999Z&viewMode=week'));

    expect(response.status).toBe(200);
    expect(listMobileAgendaEvents).toHaveBeenCalledWith(
      { userId: 'user-1', contaId: 'conta-1' },
      expect.objectContaining({
        start: '2026-09-13T00:00:00.000Z',
        end: '2026-09-19T23:59:59.999Z',
        viewMode: 'week',
      }),
    );
  });

  it('não aceita criar evento sem payload válido', async () => {
    verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });

    const response = await POST(request('/api/mobile/agenda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Aula' }),
    }));

    expect(response.status).toBe(422);
    expect(createMobileAgendaEvent).not.toHaveBeenCalled();
  });
});
