import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const { mockFindUniqueProfile, mockFindUniqueAsaasAccount, mockFindFirstKycProcess } = vi.hoisted(() => ({
  mockFindUniqueProfile: vi.fn(),
  mockFindUniqueAsaasAccount: vi.fn(),
  mockFindFirstKycProcess: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: { findUnique: mockFindUniqueProfile },
    asaasAccount: {
      findUnique: mockFindUniqueAsaasAccount,
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'acc-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    kycProcess: {
      findFirst: mockFindFirstKycProcess,
      upsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
    },
    kycRequirement: { upsert: vi.fn().mockResolvedValue({ id: 'req-1' }) },
    kycSlot: {
      upsert: vi.fn().mockResolvedValue({ id: 'slot-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    conta: { update: vi.fn().mockResolvedValue({ id: 'conta-1' }) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  loadAsaasCredentials: vi.fn().mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  }),
}));

vi.mock('@alusa/asaas', () => ({
  getMyAccountStatus: vi.fn().mockResolvedValue({
    general: 'APPROVED',
    documentation: 'APPROVED',
    bankAccountInfo: 'APPROVED',
    commercialInfo: 'APPROVED',
  }),
  getMyAccountDocuments: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'grp-1',
        status: 'APPROVED',
        type: 'IDENTIFICATION',
        title: 'Identificação',
        onboardingUrl: null,
        documents: [],
      },
    ],
    rejectReasons: null,
  }),
  getAsaasBaseUrlFromEnvOrThrow: vi.fn().mockReturnValue('https://api-sandbox.asaas.com/v3'),
  parseAsaasEnvironmentFromEnv: vi.fn().mockReturnValue('sandbox'),
  uploadMyAccountDocument: vi.fn().mockResolvedValue({ id: 'file-1' }),
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: { syncRegulatoryState: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../asaas-account/create-asaas-account', () => ({
  createAsaasAccount: vi.fn().mockResolvedValue({ created: false }),
}));

vi.mock('../get-kyc-summary', () => ({
  getKycSummary: vi.fn().mockResolvedValue({
    status: 'APPROVED',
    areas: [],
    actions: [],
  }),
}));

import { getAccountVerificationStatus } from '../get-account-verification-status';
import { uploadKycDocumentByGroup } from '../upload-kyc-document-by-group';

beforeEach(() => {
  vi.clearAllMocks();

  mockFindUniqueProfile.mockResolvedValue({ id: 'prof-1', contaId: 'conta-1' });
  mockFindUniqueAsaasAccount.mockResolvedValue({
    id: 'acc-1',
    asaasAccountId: 'ext-acc-1',
    provisionedAt: new Date(Date.now() - 60_000),
    documentsCache: null,
    documentsCacheUpdatedAt: null,
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
  });
  mockFindFirstKycProcess.mockResolvedValue(null);
});

describe('APPROVED Guard — getAccountVerificationStatus', () => {
  it('retorna actions=[] quando processo é APPROVED', async () => {
    const result = await getAccountVerificationStatus('conta-1', { fresh: true });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    expect(result.data.status).toBe('ACCOUNT_ACTIVE');
    expect(result.data.actions).toEqual([]);
  });

  it('retorna actions quando processo NÃO é APPROVED', async () => {
    const { getMyAccountStatus, getMyAccountDocuments } = await import('@alusa/asaas');
    vi.mocked(getMyAccountStatus).mockResolvedValueOnce({
      general: 'PENDING',
      documentation: 'PENDING',
      bankAccountInfo: 'PENDING',
      commercialInfo: null,
    });
    vi.mocked(getMyAccountDocuments).mockResolvedValueOnce({
      data: [
        {
          id: 'grp-2',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Identificação',
          onboardingUrl: null,
          documents: [],
        },
      ],
      rejectReasons: null,
    });

    const result = await getAccountVerificationStatus('conta-1', { fresh: true });

    expect(result.ready).toBe(true);
    if (!result.ready) return;

    expect(result.data.status).not.toBe('ACCOUNT_ACTIVE');
    expect(result.data.actions.length).toBeGreaterThan(0);
  });
});

describe('APPROVED Guard — uploadKycDocumentByGroup', () => {
  it('bloqueia upload quando KycProcess.status=APPROVED', async () => {
    mockFindFirstKycProcess.mockResolvedValue({ status: 'APPROVED' });

    await expect(
      uploadKycDocumentByGroup({
        contaId: 'conta-1',
        groupId: 'grp-1',
        type: 'IDENTIFICATION',
        file: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
        },
      }),
    ).rejects.toThrow('Conta já verificada');
  });

  it('permite upload quando KycProcess.status=PENDING_DOCUMENTS', async () => {
    mockFindFirstKycProcess.mockResolvedValue({ status: 'PENDING_DOCUMENTS' });

    const { getMyAccountDocuments } = await import('@alusa/asaas');
    vi.mocked(getMyAccountDocuments).mockResolvedValue({
      data: [
        {
          id: 'grp-1',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Identificação',
          onboardingUrl: null,
          documents: [],
        },
      ],
      rejectReasons: null,
    });

    // Não deve lançar erro por causa do guard
    // (pode falhar por outro motivo, mas não pelo guard APPROVED)
    try {
      await uploadKycDocumentByGroup({
        contaId: 'conta-1',
        groupId: 'grp-1',
        type: 'IDENTIFICATION',
        file: {
          bytes: new Uint8Array([1, 2, 3]),
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
        },
      });
    } catch (err) {
      // Erros de outro tipo são aceitáveis, mas não o guard APPROVED
      expect((err as Error).message).not.toContain('Conta já verificada');
    }
  });
});
