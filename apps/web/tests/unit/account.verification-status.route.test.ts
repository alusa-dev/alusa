import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountVerificationStatusMock = vi.fn();
const resolveTenantSessionMock = vi.fn();
const getAccountVerificationCacheMock = vi.fn();
const setAccountVerificationCacheMock = vi.fn();

vi.mock('@alusa/finance/use-cases/kyc/get-account-verification-status', () => ({
  getAccountVerificationStatus: (...args: unknown[]) => getAccountVerificationStatusMock(...args),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: (...args: unknown[]) => resolveTenantSessionMock(...args),
}));

vi.mock('@/src/server/kyc/account-verification-cache', () => ({
  accountVerificationCacheControl: 'private, no-store',
  getAccountVerificationCache: (...args: unknown[]) => getAccountVerificationCacheMock(...args),
  setAccountVerificationCache: (...args: unknown[]) => setAccountVerificationCacheMock(...args),
}));

import { GET } from '@/app/api/account/verification-status/route';

function request(query = '') {
  return new Request(`http://localhost/api/account/verification-status${query}`);
}

describe('GET /api/account/verification-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, userId: 'user-1', contaId: 'conta-1', role: 'ADMIN' });
    getAccountVerificationCacheMock.mockReturnValue({ body: null, state: 'MISS' });
    getAccountVerificationStatusMock.mockResolvedValue({ ready: true, data: { status: 'ACCOUNT_PENDING_ACTIVATION' } });
  });

  it('usa apenas o read model persistido para leituras automáticas', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(getAccountVerificationStatusMock).toHaveBeenCalledWith('conta-1', {
      fresh: false,
      readModelOnly: true,
    });
  });

  it('mantém fresh explícito para atualização manual', async () => {
    const response = await GET(request('?fresh=1'));

    expect(response.status).toBe(200);
    expect(getAccountVerificationStatusMock).toHaveBeenCalledWith('conta-1', {
      fresh: true,
      readModelOnly: false,
    });
  });
});
