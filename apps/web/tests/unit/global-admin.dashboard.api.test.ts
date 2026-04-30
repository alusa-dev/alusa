/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/global-admin/auth/session.server', () => ({
  requireGlobalAdminSessionForApi: vi.fn(),
}));

vi.mock('@/features/global-admin/dashboard/queries', () => ({
  getGlobalAdminDashboard: vi.fn(),
}));

import { GET } from '@/app/api/global-admin/dashboard/route';
import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { getGlobalAdminDashboard } from '@/features/global-admin/dashboard/queries';

describe('GET /api/global-admin/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando sem sessão global', async () => {
    vi.mocked(requireGlobalAdminSessionForApi).mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 401 }),
    } as never);

    const res = await GET(new Request('http://localhost/api/global-admin/dashboard'));
    expect(res.status).toBe(401);
  });

  it('retorna dashboard consolidado para sessão válida', async () => {
    vi.mocked(requireGlobalAdminSessionForApi).mockResolvedValue({
      ok: true,
      session: { username: 'alusa', issuedAt: '', expiresAt: '' },
    } as never);
    vi.mocked(getGlobalAdminDashboard).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      summary: {
        activeIncidents: 1,
        tenantsWithBadWebhook: 1,
        queuesWithError: 0,
        globalBacklog: 3,
        financialDivergences: 2,
      },
      incidents: [],
    } as never);

    const res = await GET(new Request('http://localhost/api/global-admin/dashboard?windowDays=14'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(getGlobalAdminDashboard).toHaveBeenCalledWith(14);
    expect(json).toMatchObject({ success: true, data: { summary: { globalBacklog: 3 } } });
  });
});
