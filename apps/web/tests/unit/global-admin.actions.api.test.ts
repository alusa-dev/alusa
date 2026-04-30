/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/global-admin/auth/session.server', () => ({
  requireGlobalAdminSessionForApi: vi.fn(),
}));

vi.mock('@/features/global-admin/actions/commands', () => ({
  executeGlobalAdminAction: vi.fn(),
}));

import { POST } from '@/app/api/global-admin/actions/[action]/route';
import { executeGlobalAdminAction } from '@/features/global-admin/actions/commands';
import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';

describe('POST /api/global-admin/actions/[action]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia sem sessão global', async () => {
    vi.mocked(requireGlobalAdminSessionForApi).mockResolvedValue({
      ok: false,
      response: Response.json({ success: false }, { status: 401 }),
    } as never);

    const res = await POST(new Request('http://localhost/api/global-admin/actions/repair-webhook', {
      method: 'POST',
      body: JSON.stringify({ tenantId: 'c1', reason: 'teste' }),
    }), { params: { action: 'repair-webhook' } });

    expect(res.status).toBe(401);
  });

  it('executa ação e retorna resultado auditável', async () => {
    vi.mocked(requireGlobalAdminSessionForApi).mockResolvedValue({
      ok: true,
      session: { username: 'alusa', issuedAt: '', expiresAt: '' },
    } as never);
    vi.mocked(executeGlobalAdminAction).mockResolvedValue({
      success: true,
      action: 'global_admin.webhook.repair',
      tenantId: 'c1',
      summary: 'Webhook reparado com sucesso.',
      auditId: 'audit-1',
      data: { repaired: true },
    } as never);

    const res = await POST(new Request('http://localhost/api/global-admin/actions/repair-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'c1', reason: 'corrigir webhook' }),
    }), { params: { action: 'repair-webhook' } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(executeGlobalAdminAction).toHaveBeenCalledWith(
      'repair-webhook',
      { tenantId: 'c1', reason: 'corrigir webhook' },
      { username: 'alusa' },
    );
    expect(json).toMatchObject({
      success: true,
      data: { auditId: 'audit-1' },
    });
  });
});
