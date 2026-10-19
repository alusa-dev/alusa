import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantSession: vi.fn(),
  approveSandboxKyc: vi.fn(),
  getAccountVerificationStatus: vi.fn(),
  invalidateAccountVerificationCache: vi.fn(),
  setAccountVerificationCache: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.resolveTenantSession }));
vi.mock('@alusa/finance/use-cases/kyc/approve-sandbox-kyc', () => ({
  approveSandboxKyc: mocks.approveSandboxKyc,
}));
vi.mock('@alusa/finance/use-cases/kyc/get-account-verification-status', () => ({
  getAccountVerificationStatus: mocks.getAccountVerificationStatus,
}));
vi.mock('@/src/server/kyc/account-verification-cache', () => ({
  invalidateAccountVerificationCache: mocks.invalidateAccountVerificationCache,
  setAccountVerificationCache: mocks.setAccountVerificationCache,
}));

import { POST } from '@/app/api/kyc/sandbox/approve/route';

describe('POST /api/kyc/sandbox/approve capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantSession.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      contaId: 'conta-ext',
      role: 'ADMIN',
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    });
  });

  it('bloqueia KYC externo antes de aprovar no provider ou tocar cache', async () => {
    const response = await POST(new Request('http://localhost/api/kyc/sandbox/approve', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'FINANCE_CAPABILITY_UNAVAILABLE', capability: 'kyc' });
    expect(mocks.approveSandboxKyc).not.toHaveBeenCalled();
    expect(mocks.getAccountVerificationStatus).not.toHaveBeenCalled();
    expect(mocks.invalidateAccountVerificationCache).not.toHaveBeenCalled();
    expect(mocks.setAccountVerificationCache).not.toHaveBeenCalled();
  });
});
