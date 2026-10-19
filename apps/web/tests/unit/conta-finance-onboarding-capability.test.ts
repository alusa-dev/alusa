import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantSession: vi.fn(),
  asaasGetMyAccountCommercialInfo: vi.fn(),
  getKycSummary: vi.fn(),
  getFinanceOnboardingContext: vi.fn(),
  mapContaFinanceOnboardingResultToDTO: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.resolveTenantSession }));
vi.mock('@alusa/finance', () => ({
  asaasGetMyAccountCommercialInfo: mocks.asaasGetMyAccountCommercialInfo,
  getKycSummary: mocks.getKycSummary,
}));
vi.mock('@/src/server/finance/admin-integration.service', () => ({
  getFinanceOnboardingContext: mocks.getFinanceOnboardingContext,
}));
vi.mock('@/features/account/mappers', () => ({
  mapContaFinanceOnboardingResultToDTO: mocks.mapContaFinanceOnboardingResultToDTO,
}));

import { GET } from '@/app/api/conta/finance-onboarding/route';

describe('GET /api/conta/finance-onboarding capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantSession.mockResolvedValue({
      ok: true,
      contaId: 'conta-ext',
      role: 'ADMIN',
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    });
  });

  it('não retorna resumo KYC/onboarding de conta externa', async () => {
    const response = await GET(new Request('http://localhost/api/conta/finance-onboarding'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'FINANCE_CAPABILITY_UNAVAILABLE', capability: 'kyc' });
    expect(mocks.getFinanceOnboardingContext).not.toHaveBeenCalled();
    expect(mocks.getKycSummary).not.toHaveBeenCalled();
    expect(mocks.asaasGetMyAccountCommercialInfo).not.toHaveBeenCalled();
    expect(mocks.mapContaFinanceOnboardingResultToDTO).not.toHaveBeenCalled();
  });
});
