import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@alusa/database', async () => {
  return {
    prisma: {
      asaasAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    },
  };
});

vi.mock('../use-cases/asaas-account/reconcile-asaas-account', async () => {
  return {
    reconcileAsaasAccount: vi.fn(async () => ({
      financeProfileId: 'fp1',
      asaasAccountId: 'acc_1',
      previousStatus: 'UNDER_REVIEW',
      updatedStatus: 'APPROVED',
      previousFinanceStatus: 'FINANCE_PROFILE_COMPLETED',
      updatedFinanceStatus: 'FINANCE_APPROVED',
      reconciled: true,
      myAccountStatus: { general: 'APPROVED' },
    })),
  };
});

import { reconcileAsaasAccountsJob, shouldReconcileNow } from './reconcile-asaas-accounts';

describe('reconcileAsaasAccountsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve processar contas em UNDER_REVIEW que passaram do throttle', async () => {
    const { prisma } = await import('@alusa/database');
    const { reconcileAsaasAccount } = await import('../use-cases/asaas-account/reconcile-asaas-account');

    const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min atrás

    vi.mocked(prisma.asaasAccount.findMany).mockResolvedValue([
      {
        id: 'aa1',
        status: 'UNDER_REVIEW',
        statusUpdatedAt: oldDate,
        asaasAccountId: 'acc_1',
        commercialInfoStatus: null,
        financeProfile: { contaId: 'c1' },
      },
    ] as never);

    const result = await reconcileAsaasAccountsJob();

    expect(result.processadas).toBe(1);
    expect(result.reconciliadas).toBe(1);
    expect(result.skippedThrottle).toBe(0);
    expect(result.erros).toHaveLength(0);

    expect(vi.mocked(reconcileAsaasAccount)).toHaveBeenCalledWith({
      contaId: 'c1',
      reason: 'scheduled_job',
      actor: { type: 'SYSTEM' },
    });
  });

  it('deve pular contas dentro do intervalo de throttle (double-check)', async () => {
    const { prisma } = await import('@alusa/database');
    const { reconcileAsaasAccount } = await import('../use-cases/asaas-account/reconcile-asaas-account');

    const recentDate = new Date(Date.now() - 1 * 60 * 1000); // 1 min atrás

    vi.mocked(prisma.asaasAccount.findMany).mockResolvedValue([
      {
        id: 'aa1',
        status: 'UNDER_REVIEW',
        statusUpdatedAt: recentDate,
        asaasAccountId: 'acc_1',
        commercialInfoStatus: null,
        financeProfile: { contaId: 'c1' },
      },
    ] as never);

    const result = await reconcileAsaasAccountsJob();

    expect(result.processadas).toBe(1);
    expect(result.skippedThrottle).toBe(1);
    expect(result.reconciliadas).toBe(0);

    expect(vi.mocked(reconcileAsaasAccount)).not.toHaveBeenCalled();
  });

  it('deve forçar reconciliação quando forceReconcile=true', async () => {
    const { prisma } = await import('@alusa/database');
    const { reconcileAsaasAccount } = await import('../use-cases/asaas-account/reconcile-asaas-account');

    const recentDate = new Date(Date.now() - 1 * 60 * 1000); // 1 min atrás

    vi.mocked(prisma.asaasAccount.findMany).mockResolvedValue([
      {
        id: 'aa1',
        status: 'UNDER_REVIEW',
        statusUpdatedAt: recentDate,
        asaasAccountId: 'acc_1',
        commercialInfoStatus: null,
        financeProfile: { contaId: 'c1' },
      },
    ] as never);

    const result = await reconcileAsaasAccountsJob({ forceReconcile: true });

    expect(result.processadas).toBe(1);
    expect(result.reconciliadas).toBe(1);
    expect(result.skippedThrottle).toBe(0);

    expect(vi.mocked(reconcileAsaasAccount)).toHaveBeenCalled();
  });

  it('deve capturar erros sem parar o processamento', async () => {
    const { prisma } = await import('@alusa/database');
    const { reconcileAsaasAccount } = await import('../use-cases/asaas-account/reconcile-asaas-account');

    const oldDate = new Date(Date.now() - 10 * 60 * 1000);

    vi.mocked(prisma.asaasAccount.findMany).mockResolvedValue([
      {
        id: 'aa1',
        status: 'UNDER_REVIEW',
        statusUpdatedAt: oldDate,
        asaasAccountId: 'acc_1',
        commercialInfoStatus: null,
        financeProfile: { contaId: 'c1' },
      },
      {
        id: 'aa2',
        status: 'UNDER_REVIEW',
        statusUpdatedAt: oldDate,
        asaasAccountId: 'acc_2',
        commercialInfoStatus: null,
        financeProfile: { contaId: 'c2' },
      },
    ] as never);

    vi.mocked(reconcileAsaasAccount)
      .mockRejectedValueOnce(new Error('Asaas indisponível'))
      .mockResolvedValueOnce({
        financeProfileId: 'fp2',
        asaasAccountId: 'acc_2',
        previousStatus: 'UNDER_REVIEW',
        updatedStatus: 'APPROVED',
        previousFinanceStatus: 'FINANCE_PROFILE_COMPLETED',
        updatedFinanceStatus: 'FINANCE_APPROVED',
        reconciled: true,
        myAccountStatus: { general: 'APPROVED' },
      } as never);

    const result = await reconcileAsaasAccountsJob();

    expect(result.processadas).toBe(2);
    expect(result.reconciliadas).toBe(1);
    expect(result.erros).toHaveLength(1);
    expect(result.erros[0]).toEqual({
      contaId: 'c1',
      erro: 'Asaas indisponível',
    });
  });
});

describe('shouldReconcileNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna should=false quando não há account', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue(null as never);

    const result = await shouldReconcileNow('c1');

    expect(result.should).toBe(false);
    expect(result.reason).toBe('no_account');
  });

  it('retorna should=true para conta aprovada com commercial info expirada', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({
      status: 'APPROVED',
      statusUpdatedAt: new Date(Date.now() - 10 * 60 * 1000),
      commercialInfoStatus: 'EXPIRED',
      financeProfile: {
        lastAsaasSyncAt: new Date(),
      },
    } as never);

    const result = await shouldReconcileNow('c1');

    expect(result).toEqual({ should: true, reason: 'ready' });
  });

  it('retorna should=true para conta aprovada com sync stale', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({
      status: 'APPROVED',
      statusUpdatedAt: new Date(Date.now() - 10 * 60 * 1000),
      commercialInfoStatus: null,
      financeProfile: {
        lastAsaasSyncAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    } as never);

    const result = await shouldReconcileNow('c1');

    expect(result).toEqual({ should: true, reason: 'ready' });
  });

  it('retorna should=false para conta aprovada sem commercial info pendente e sync recente', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.asaasAccount.findFirst).mockResolvedValue({
      status: 'APPROVED',
      statusUpdatedAt: new Date(Date.now() - 10 * 60 * 1000),
      commercialInfoStatus: null,
      financeProfile: {
        lastAsaasSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    } as never);

    const result = await shouldReconcileNow('c1');

    expect(result).toEqual({ should: false, reason: 'status_approved' });
  });
});
