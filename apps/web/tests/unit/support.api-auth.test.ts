/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireGlobalAdminSessionForApi = vi.fn();

vi.mock('@/features/global-admin/auth/session.server', () => ({
  requireGlobalAdminSessionForApi: () => mockRequireGlobalAdminSessionForApi(),
}));

import { requireSupportApi } from '@/features/support/api/support-api.server';

describe('support api auth', () => {
  beforeEach(() => {
    mockRequireGlobalAdminSessionForApi.mockReset();
  });

  it('permite acesso quando a sessão tem papel autorizado', async () => {
    mockRequireGlobalAdminSessionForApi.mockResolvedValue({
      ok: true,
      session: {
        username: 'finance',
        role: 'SUPPORT_FINANCE',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    });

    const result = await requireSupportApi(new Request('http://localhost/api/developer/financeiro'), {
      roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN'],
      scope: 'unit-finance',
    });

    expect(result.ok).toBe(true);
  });

  it('bloqueia acesso quando o papel não está autorizado', async () => {
    mockRequireGlobalAdminSessionForApi.mockResolvedValue({
      ok: true,
      session: {
        username: 'viewer',
        role: 'SUPPORT_VIEWER',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    });

    const result = await requireSupportApi(new Request('http://localhost/api/developer/audit'), {
      roles: ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN'],
      scope: 'unit-audit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});
