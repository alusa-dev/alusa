import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  mockFindManyAccounts,
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
  mockLoadCreds.mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  });
});

describe('reconcileKycModels', () => {
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
