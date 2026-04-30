/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/server/aulas/session', () => ({
  canAccessAulas: vi.fn(),
  getAulasSessionUser: vi.fn(),
}));

vi.mock('@/src/server/aulas/agenda/agenda.service', () => ({
  listAgendaLogs: vi.fn(),
  rebuildAgendaWindow: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser } = await import('@/src/server/aulas/session');
const { listAgendaLogs, rebuildAgendaWindow } = await import('@/src/server/aulas/agenda/agenda.service');
const { GET } = await import('@/app/api/aulas/agenda/logs/route');
const { POST } = await import('@/app/api/aulas/agenda/rebuild/route');

describe('/api/aulas/agenda operações', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista logs da agenda', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(listAgendaLogs).mockResolvedValueOnce({
      success: true,
      data: {
        items: [],
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/aulas/agenda/logs?limit=10'));

    expect(response.status).toBe(200);
    expect(listAgendaLogs).toHaveBeenCalledWith('conta-1', 10);
  });

  it('reconstrói a agenda com body validado', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'RECEPCAO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(rebuildAgendaWindow).mockResolvedValueOnce({
      success: true,
      data: {
        summary: {
          start: '2026-03-15T00:00:00.000Z',
          end: '2026-03-21T23:59:59.999Z',
          created: 1,
          updated: 0,
          cancelled: 0,
          deleted: 0,
          skipped: 4,
        },
        logs: [],
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/aulas/agenda/rebuild', {
        method: 'POST',
        body: JSON.stringify({
          start: '2026-03-15T00:00:00.000Z',
          end: '2026-03-21T23:59:59.999Z',
          reason: 'manual:week',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(rebuildAgendaWindow).toHaveBeenCalledWith('conta-1', {
      start: '2026-03-15T00:00:00.000Z',
      end: '2026-03-21T23:59:59.999Z',
      reason: 'manual:week',
    });
  });
});
