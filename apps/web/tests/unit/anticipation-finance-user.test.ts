import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeGetServerSessionMock = vi.fn();
const guardFinancialAccountMock = vi.fn();

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: (...args: unknown[]) => safeGetServerSessionMock(...args),
}));
vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: (...args: unknown[]) => guardFinancialAccountMock(...args),
}));

import { requireFinanceUser } from '@/app/api/financeiro/antecipacoes/_shared';

describe('requireFinanceUser for anticipations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeGetServerSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        contaId: 'conta-1',
        role: 'ADMIN',
        financeIntegrationMode: 'WHITELABEL_BAAS',
      },
    });
    guardFinancialAccountMock.mockResolvedValue({ ok: true, summary: {} });
  });

  it('bloqueia antecipações para conta Asaas externa antes do gate financeiro', async () => {
    safeGetServerSessionMock.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        contaId: 'conta-1',
        role: 'ADMIN',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
      },
    });

    const result = await requireFinanceUser();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(409);
      expect(await result.response.json()).toEqual({
        error: 'FINANCE_CAPABILITY_UNAVAILABLE',
        capability: 'anticipations',
      });
    }
    expect(guardFinancialAccountMock).not.toHaveBeenCalled();
  });
});
