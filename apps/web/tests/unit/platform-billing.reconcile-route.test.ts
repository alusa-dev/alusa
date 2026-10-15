import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSessionMock, reconcileMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/src/server/platform-billing/reconciliation', () => ({ reconcilePlatformBilling: reconcileMock }));

import { POST } from '@/app/api/admin/platform-billing/reconcile/route';

describe('POST /api/admin/platform-billing/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileMock.mockResolvedValue({ reconciled: 0 });
  });

  it('denies tenant ADMIN batch scope without invoking global reconciliation', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user_a', contaId: 'conta_a', role: 'ADMIN' } });
    const response = await POST(new NextRequest('http://alusa.test/api/admin/platform-billing/reconcile', {
      method: 'POST', body: JSON.stringify({ scope: 'batch' }),
    }));

    expect(response.status).toBe(403);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('allows batch reconciliation only for a platform SUPER_ADMIN', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'operator', role: 'SUPER_ADMIN' } });
    const response = await POST(new NextRequest('http://alusa.test/api/admin/platform-billing/reconcile', {
      method: 'POST', body: JSON.stringify({ scope: 'batch', limit: 5 }),
    }));

    expect(response.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledWith({ contaId: undefined, limit: 5 });
  });

  it('keeps tenant ADMIN reconciliation restricted to the session Conta', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user_a', contaId: 'conta_a', role: 'ADMIN' } });
    const response = await POST(new NextRequest('http://alusa.test/api/admin/platform-billing/reconcile', {
      method: 'POST', body: JSON.stringify({ scope: 'current_account' }),
    }));

    expect(response.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledWith({ contaId: 'conta_a', limit: undefined });
  });
});
