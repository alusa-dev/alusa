import { describe, expect, it, vi } from 'vitest';

import { GET } from '../summary/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({
    ok: true,
    summary: {
      asaasConnection: { status: 'CONNECTED' },
      generalStatus: 'PENDING',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'PENDING',
      commercialInfoAreaStatus: 'PENDING',
      processStatus: 'PENDING_DOCUMENTS',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      hasBlockingPending: true,
      nextActions: [],
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
    },
  })),
}));

describe('GET /api/kyc/summary', () => {
  it('retorna 401 sem sessão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('retorna 403 sem permissão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce({ user: { id: 'u1', contaId: 'c1', role: 'RECEPCAO' } } as never);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('retorna 200 com dados', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce({ user: { id: 'u1', contaId: 'c1', role: 'ADMIN' } } as never);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeTruthy();
  });
});
