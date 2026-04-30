import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', async () => {
  return {
    getSubaccount: vi.fn(async () => ({ object: 'account', id: 'acc_1', name: 'X', email: 'x@x.com', cpfCnpj: '1' })),
    getMyAccountStatus: vi.fn(async () => ({ general: 'APPROVED' })),
  };
});

vi.mock('@alusa/database', async () => {
  return {
    prisma: {
      conta: { findUnique: vi.fn(), update: vi.fn() },
      financeProfile: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      asaasAccount: { findUnique: vi.fn(), update: vi.fn() },
      asaasAccountStatusHistory: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn((await import('@alusa/database')).prisma)),
    },
    loadAsaasCredentials: vi.fn(),
  };
});

vi.mock('../../foundation/audit-log.service', async () => {
  return {
    auditLogService: { record: vi.fn(async () => ({ id: 'a1' })) },
  };
});

const mockEnsureSubaccountEmailSynced = vi.fn(async () => ({ synced: false, canonicalEmail: null }));

vi.mock('../asaas-account/ensure-subaccount-email-synced', async () => ({
  ensureSubaccountEmailSynced: (...args: unknown[]) => mockEnsureSubaccountEmailSynced(...args),
}));

import { reconcileAsaasAccount } from '../asaas-account/reconcile-asaas-account';

describe('reconcileAsaasAccount', () => {
  beforeEach(async () => {
    process.env.ASAAS_API_KEY = 'master_x';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({ financeStatus: 'FINANCE_ONBOARDING_STARTED' } as never);
    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue({ id: 'fp1' } as never);
    vi.mocked(prisma.financeProfile.update).mockResolvedValue({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({
      id: 'aa1',
      status: 'IN_PROGRESS',
      asaasAccountId: 'acc_1',
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'sub_x' } as never);
    mockEnsureSubaccountEmailSynced.mockResolvedValue({ synced: false, canonicalEmail: null });
  });

  it('promove para APPROVED quando myAccount.general === APPROVED e atualiza financeStatus', async () => {
    const { prisma } = await import('@alusa/database');

    const result = await reconcileAsaasAccount({ contaId: 'c1', reason: 'test' });

    expect(result.updatedStatus).toBe('APPROVED');
    expect(result.updatedFinanceStatus).toBe('FINANCE_APPROVED');

    expect(vi.mocked(prisma.asaasAccount.update)).toHaveBeenCalled();
    expect(vi.mocked(prisma.conta.update)).toHaveBeenCalled();
    expect(vi.mocked(prisma.asaasAccountStatusHistory.create)).toHaveBeenCalled();
  });

  it('mantém CREATED (e FINANCE_PROFILE_COMPLETED) quando não há credenciais da subconta', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const result = await reconcileAsaasAccount({ contaId: 'c1', reason: 'no-creds' });

    expect(result.updatedStatus).toBe('CREATED');
    expect(result.updatedFinanceStatus).toBe('FINANCE_PROFILE_COMPLETED');

    expect(vi.mocked(prisma.asaasAccount.update)).toHaveBeenCalled();
    expect(vi.mocked(prisma.conta.update)).toHaveBeenCalled();
  });
});
