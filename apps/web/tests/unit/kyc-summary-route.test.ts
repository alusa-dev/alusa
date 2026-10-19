import { beforeEach, describe, expect, it, vi } from 'vitest';

const getKycSummaryMock = vi.fn();
const resolveTenantSessionMock = vi.fn();

vi.mock('@alusa/finance', () => ({ getKycSummary: (...args: unknown[]) => getKycSummaryMock(...args) }));
vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: (...args: unknown[]) => resolveTenantSessionMock(...args),
}));

import { GET } from '@/app/api/kyc/summary/route';

describe('GET /api/kyc/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
      financeIntegrationMode: 'WHITELABEL_BAAS',
    });
  });

  it('bloqueia KYC para conta Asaas externa antes de consultar o use case', async () => {
    resolveTenantSessionMock.mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'FINANCE_CAPABILITY_UNAVAILABLE', capability: 'kyc' });
    expect(getKycSummaryMock).not.toHaveBeenCalled();
  });
});
