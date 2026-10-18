import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  mockFindManyAccounts,
  mockFindUniqueAsaasAccount,
  mockFindUniqueKycProcess,
  mockAsaasAccountUpdate,
  mockKycProcessUpsert,
  mockKycRequirementUpsert,
  mockKycSlotUpsert,
  mockLoadCreds,
  mockGetStatus,
  mockGetDocs,
  mockAuditRecord,
} = vi.hoisted(() => ({
  mockFindManyAccounts: vi.fn(),
  mockFindUniqueAsaasAccount: vi.fn(),
  mockFindUniqueKycProcess: vi.fn(),
  mockAsaasAccountUpdate: vi.fn().mockResolvedValue({ id: 'acc-1' }),
  mockKycProcessUpsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
  mockKycRequirementUpsert: vi.fn().mockResolvedValue({ id: 'req-1' }),
  mockKycSlotUpsert: vi.fn().mockResolvedValue({ id: 'slot-1' }),
  mockLoadCreds: vi.fn(),
  mockGetStatus: vi.fn(),
  mockGetDocs: vi.fn(),
  mockAuditRecord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: {
      findMany: mockFindManyAccounts,
      findUnique: mockFindUniqueAsaasAccount,
      update: mockAsaasAccountUpdate,
    },
    kycProcess: {
      findUnique: mockFindUniqueKycProcess,
      upsert: mockKycProcessUpsert,
    },
    kycRequirement: { upsert: mockKycRequirementUpsert },
    kycSlot: { upsert: mockKycSlotUpsert },
  },
  loadAsaasCredentials: mockLoadCreds,
}));

vi.mock('@alusa/asaas', () => ({
  getMyAccountStatus: (...args: unknown[]) => mockGetStatus(...args),
  getMyAccountDocuments: (...args: unknown[]) => mockGetDocs(...args),
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

import { reconcileKycModels } from '../kyc-reconciliation.service';
import type { KycReconciliationResult } from '../kyc-reconciliation.service';

beforeEach(() => {
  vi.clearAllMocks();
  mockAsaasAccountUpdate.mockReset().mockResolvedValue({ id: 'acc-1' });
  mockFindUniqueAsaasAccount.mockResolvedValue({
    provisionedAt: null,
    documentsCache: {
      version: 2,
      myAccountStatus: { general: 'PENDING', documentation: 'PENDING', bankAccountInfo: 'PENDING' },
      groups: [],
      rejectReasons: [],
      fetchedAt: new Date().toISOString(),
    },
    documentsCacheUpdatedAt: new Date(),
  });
  mockLoadCreds.mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  });
});

describe('reconcileKycModels', () => {
  const healthyAccount = {
    id: 'acc-1',
    asaasAccountId: 'ext-acc-1',
    status: 'PENDING',
    financeProfile: { contaId: 'conta-1' },
  };

  it('hidrata um read model ausente depois da espera de provisionamento', async () => {
    mockFindManyAccounts.mockResolvedValue([healthyAccount]);
    mockFindUniqueKycProcess.mockResolvedValue(null);
    mockFindUniqueAsaasAccount.mockResolvedValue({
      provisionedAt: new Date(Date.now() - 16_000),
      documentsCache: null,
      documentsCacheUpdatedAt: null,
    });
    mockGetStatus.mockResolvedValue({ general: 'PENDING', documentation: 'PENDING' });
    mockGetDocs.mockResolvedValue({ data: [], rejectReasons: null });

    const result = await reconcileKycModels();

    expect(result.inconsistenciesFound).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockAsaasAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ documentsCacheUpdatedAt: expect.any(Date) }),
    }));
  });

  it('não consulta o provedor antes dos 15s, adiando a hidratação para uma execução posterior', async () => {
    mockFindManyAccounts.mockResolvedValue([healthyAccount]);
    mockFindUniqueKycProcess.mockResolvedValue(null);
    mockFindUniqueAsaasAccount.mockResolvedValue({
      provisionedAt: new Date(),
      documentsCache: null,
      documentsCacheUpdatedAt: null,
    });

    const result = await reconcileKycModels();

    expect(result.inconsistenciesFound).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('refresca read model vencido e não espera inconsistência em KycProcess', async () => {
    mockFindManyAccounts.mockResolvedValue([healthyAccount]);
    mockFindUniqueKycProcess.mockResolvedValue(null);
    let cacheUpdatedAt = new Date(Date.now() - 25 * 60 * 60_000);
    const expiredCache = {
      version: 2,
      groups: [],
      myAccountStatus: null,
      rejectReasons: [],
      fetchedAt: cacheUpdatedAt.toISOString(),
    };
    mockFindUniqueAsaasAccount.mockImplementation(async () => ({
      provisionedAt: new Date(Date.now() - 60_000),
      documentsCache: cacheUpdatedAt.getTime() < Date.now() - 24 * 60 * 60_000 ? expiredCache : {
        ...expiredCache,
        fetchedAt: cacheUpdatedAt.toISOString(),
      },
      documentsCacheUpdatedAt: cacheUpdatedAt,
    }));
    mockAsaasAccountUpdate.mockImplementation(async (args: { data: { documentsCacheUpdatedAt: Date } }) => {
      cacheUpdatedAt = args.data.documentsCacheUpdatedAt;
      return { id: 'acc-1' };
    });
    mockGetStatus.mockResolvedValue({ general: 'PENDING', documentation: 'PENDING' });
    mockGetDocs.mockResolvedValue({ data: [], rejectReasons: null });

    const result = await reconcileKycModels();
    expect(result.inconsistenciesFound).toBe(1);
    expect(result.reconciled).toBe(1);

    const repeatedResult = await reconcileKycModels();

    expect(repeatedResult.inconsistenciesFound).toBe(0);
    expect(repeatedResult.reconciled).toBe(0);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('avança o lote para contas sem cache após hidratar as primeiras 100', async () => {
    const provisionedAt = new Date(Date.now() - 60_000);
    const accounts = Array.from({ length: 105 }, (_, index) => ({
      id: `acc-${String(index).padStart(3, '0')}`,
      asaasAccountId: `ext-${index}`,
      status: 'PENDING',
      createdAt: new Date(Date.now() - (105 - index) * 1_000),
      financeProfile: { contaId: `conta-${index}` },
    }));
    const accountStates = new Map(accounts.map((account) => [account.id, {
      provisionedAt,
      documentsCache: null as object | null,
      documentsCacheUpdatedAt: null as Date | null,
    }]));

    mockFindManyAccounts.mockImplementation(async (args: { take: number; orderBy: unknown }) => {
      expect(args.orderBy).toEqual([
        { documentsCacheUpdatedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ]);
      return [...accounts]
        .sort((a, b) => {
          const aUpdated = accountStates.get(a.id)?.documentsCacheUpdatedAt ?? null;
          const bUpdated = accountStates.get(b.id)?.documentsCacheUpdatedAt ?? null;
          if (aUpdated === null && bUpdated !== null) return -1;
          if (aUpdated !== null && bUpdated === null) return 1;
          if (aUpdated && bUpdated && aUpdated.getTime() !== bUpdated.getTime()) {
            return aUpdated.getTime() - bUpdated.getTime();
          }
          return a.createdAt.getTime() - b.createdAt.getTime();
        })
        .slice(0, args.take);
    });
    mockFindUniqueAsaasAccount.mockImplementation(async (args: { where: { id: string } }) => accountStates.get(args.where.id));
    mockAsaasAccountUpdate.mockImplementation(async (args: {
      where: { id: string };
      data: { documentsCache: object; documentsCacheUpdatedAt: Date };
    }) => {
      const current = accountStates.get(args.where.id)!;
      accountStates.set(args.where.id, {
        ...current,
        documentsCache: args.data.documentsCache,
        documentsCacheUpdatedAt: args.data.documentsCacheUpdatedAt,
      });
      return { id: args.where.id };
    });
    mockFindUniqueKycProcess.mockResolvedValue(null);
    mockGetStatus.mockResolvedValue({ general: 'PENDING', documentation: 'PENDING' });
    mockGetDocs.mockResolvedValue({ data: [], rejectReasons: null });

    const firstRun = await reconcileKycModels();
    expect(firstRun.checkedAccounts).toBe(100);
    expect(firstRun.reconciled).toBe(100);
    expect(firstRun.details.some((item) => item.asaasAccountId === 'ext-104')).toBe(false);

    const secondRun = await reconcileKycModels();
    expect(secondRun.checkedAccounts).toBe(100);
    expect(secondRun.reconciled).toBe(5);
    expect(secondRun.details.some((item) => item.asaasAccountId === 'ext-104')).toBe(true);
    expect(mockGetStatus).toHaveBeenCalledTimes(105);
    expect(mockGetDocs).toHaveBeenCalledTimes(105);
  });

  it('detecta KycSlot NOT_SENT em processo APPROVED', async () => {
    mockFindManyAccounts.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        status: 'APPROVED',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockFindUniqueKycProcess.mockResolvedValue({
      id: 'proc-1',
      status: 'APPROVED',
      requirements: [
        {
          id: 'req-1',
          groupId: '00000000-0000-0000-0000-000000000000',
          status: 'APPROVED',
          slots: [
            {
              id: 'slot-1',
              slotId: '00000000-0000-0000-0000-000000000000',
              status: 'NOT_SENT',
              uploadedFileId: null,
            },
          ],
        },
      ],
    });

    mockGetStatus.mockResolvedValue({
      general: 'APPROVED',
      documentation: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      commercialInfo: 'APPROVED',
    });

    mockGetDocs.mockResolvedValue({
      data: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          status: 'APPROVED',
          type: 'IDENTIFICATION',
          title: 'Identificação',
          onboardingUrl: null,
          documents: [],
        },
      ],
      rejectReasons: null,
    });

    const result = await reconcileKycModels();

    expect(result.checkedAccounts).toBe(1);
    expect(result.inconsistenciesFound).toBeGreaterThan(0);
    expect(result.reconciled).toBe(1);
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.kyc.reconciliation',
      }),
    );
  });

  it('não detecta inconsistências quando tudo está ok', async () => {
    mockFindManyAccounts.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        status: 'APPROVED',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockFindUniqueKycProcess.mockResolvedValue({
      id: 'proc-1',
      status: 'APPROVED',
      requirements: [
        {
          id: 'req-1',
          groupId: 'real-uuid',
          status: 'APPROVED',
          slots: [
            {
              id: 'slot-1',
              slotId: 'real-slot-uuid',
              status: 'APPROVED',
              uploadedFileId: 'file-1',
            },
          ],
        },
      ],
    });

    const result = await reconcileKycModels();

    expect(result.checkedAccounts).toBe(1);
    expect(result.inconsistenciesFound).toBe(0);
    expect(result.reconciled).toBe(0);
  });

  it('modo dryRun não corrige inconsistências', async () => {
    mockFindManyAccounts.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        status: 'APPROVED',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockFindUniqueKycProcess.mockResolvedValue({
      id: 'proc-1',
      status: 'APPROVED',
      requirements: [
        {
          id: 'req-1',
          groupId: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          slots: [],
        },
      ],
    });

    const result = await reconcileKycModels({ dryRun: true });

    expect(result.inconsistenciesFound).toBeGreaterThan(0);
    expect(result.reconciled).toBe(0);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it('é fail-safe quando loadAsaasCredentials retorna null', async () => {
    mockFindManyAccounts.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        status: 'APPROVED',
        financeProfile: { contaId: 'conta-1' },
      },
    ]);

    mockFindUniqueKycProcess.mockResolvedValue({
      id: 'proc-1',
      status: 'APPROVED',
      requirements: [
        {
          id: 'req-1',
          groupId: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          slots: [],
        },
      ],
    });

    mockLoadCreds.mockResolvedValue(null);

    const result = await reconcileKycModels();

    expect(result.inconsistenciesFound).toBeGreaterThan(0);
    expect(result.reconciled).toBe(0);
  });
});
