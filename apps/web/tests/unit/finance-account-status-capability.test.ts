import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantSession: vi.fn(),
  getKycCommercialInfo: vi.fn(),
  getKycSummary: vi.fn(),
  getKycSummaryFresh: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.resolveTenantSession }));
vi.mock('@alusa/finance', () => ({
  getKycCommercialInfo: mocks.getKycCommercialInfo,
  getKycSummary: mocks.getKycSummary,
  getKycSummaryFresh: mocks.getKycSummaryFresh,
}));

import { GET } from '@/app/api/finance/account-status/route';

describe('GET /api/finance/account-status capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantSession.mockResolvedValue({
      ok: true,
      contaId: 'conta-ext',
      role: 'ADMIN',
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    });
  });

  it('bloqueia KYC externo antes de consultar summary ou provider', async () => {
    const response = await GET(new Request('http://localhost/api/finance/account-status?fresh=1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'FINANCE_CAPABILITY_UNAVAILABLE', capability: 'kyc' });
    expect(mocks.getKycSummary).not.toHaveBeenCalled();
    expect(mocks.getKycSummaryFresh).not.toHaveBeenCalled();
    expect(mocks.getKycCommercialInfo).not.toHaveBeenCalled();
  });
});
