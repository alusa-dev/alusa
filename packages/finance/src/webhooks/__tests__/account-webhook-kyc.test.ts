import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories can only reference hoisted vars) ────

const {
  mockFindUniqueProfile,
  mockFindUniqueAccount,
  mockUpdateAccount,
  mockUpdateConta,
  mockCreateHistory,
  mockTransaction,
  mockKycProcessUpsert,
} = vi.hoisted(() => {
  const mockUpdateAccount = vi.fn().mockResolvedValue({ id: 'acc-1' });
  const mockUpdateConta = vi.fn().mockResolvedValue({ id: 'conta-1' });
  const mockCreateHistory = vi.fn().mockResolvedValue({ id: 'hist-1' });

  return {
    mockFindUniqueProfile: vi.fn(),
    mockFindUniqueAccount: vi.fn(),
    mockUpdateAccount,
    mockUpdateConta,
    mockCreateHistory,
    mockTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        asaasAccount: { update: mockUpdateAccount },
        asaasAccountStatusHistory: { create: mockCreateHistory },
        conta: { update: mockUpdateConta },
      });
    }),
    mockKycProcessUpsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
  };
});

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: { findUnique: mockFindUniqueProfile },
    asaasAccount: { findUnique: mockFindUniqueAccount, update: mockUpdateAccount },
    conta: { update: mockUpdateConta },
    kycProcess: { upsert: mockKycProcessUpsert },
    kycRequirement: { upsert: vi.fn().mockResolvedValue({ id: 'req-1' }) },
    kycSlot: { upsert: vi.fn().mockResolvedValue({ id: 'slot-1' }) },
    $transaction: mockTransaction,
  },
  loadAsaasCredentials: vi.fn().mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  }),
}));

vi.mock('@alusa/asaas', () => ({
  getMyAccountStatus: vi.fn().mockResolvedValue({
    general: 'PENDING',
    documentation: 'PENDING',
    bankAccountInfo: 'PENDING',
    commercialInfo: null,
    commercialInfoExpiration: null,
  }),
  getMyAccountDocuments: vi.fn().mockResolvedValue({
    data: [],
    rejectReasons: [],
  }),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: { syncRegulatoryState: vi.fn().mockResolvedValue(undefined) },
}));

import { handleAccountWebhook } from '../account-webhook-handler';
import { prisma } from '@alusa/database';

beforeEach(() => {
  vi.clearAllMocks();

  mockFindUniqueProfile.mockResolvedValue({ id: 'prof-1' });
  mockFindUniqueAccount.mockResolvedValue({
    id: 'acc-1',
    status: 'IN_PROGRESS',
    asaasAccountId: 'ext-acc-1',
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
  });
});

describe('handleAccountWebhook — KYC persist', () => {
  it('chama syncKycModels via refreshDocumentsCacheV2 em evento DOCUMENT', async () => {
    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
      payloadId: 'evt-1',
    });

    expect(result.success).toBe(true);
    // syncKycModels é chamado dentro do refreshDocumentsCacheV2 (best-effort)
    // A chamada a getMyAccountDocuments confirma que o refresh foi executado
    const { getMyAccountDocuments } = await import('@alusa/asaas');
    expect(vi.mocked(getMyAccountDocuments)).toHaveBeenCalledOnce();
  });

  it('chama updateKycProcessStatus em GENERAL_APPROVAL_APPROVED', async () => {
    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
      payloadId: 'evt-2',
    });

    expect(result.success).toBe(true);
    // KycProcess deve ter sido upserted com APPROVED
    expect(vi.mocked(prisma.kycProcess.upsert)).toHaveBeenCalled();
    const call = vi.mocked(prisma.kycProcess.upsert).mock.calls[0][0];
    expect(call.create.status).toBe('APPROVED');
  });

  it('chama updateKycProcessStatus em GENERAL_APPROVAL_REJECTED', async () => {
    await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
      payloadId: 'evt-3',
    });

    expect(vi.mocked(prisma.kycProcess.upsert)).toHaveBeenCalled();
    const call = vi.mocked(prisma.kycProcess.upsert).mock.calls[0][0];
    expect(call.create.status).toBe('REJECTED');
  });

  it('não deriva status KYC diretamente de evento comercial', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'IN_PROGRESS',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
      payloadId: 'evt-4',
    });

    expect(result.success).toBe(true);

    // Evento comercial não altera o status do AsaasAccount (onboardingStatus)
    expect(mockTransaction).not.toHaveBeenCalled();

    // kycProcess.upsert pode ser chamado via syncKycModels (cache refresh best-effort),
    // mas NÃO via updateKycProcessStatus direto (mapEventToKycStatus retorna null).
  });

  it('retorna erro se FinanceProfile não encontrado', async () => {
    mockFindUniqueProfile.mockResolvedValue(null);

    const result = await handleAccountWebhook('conta-inexistente', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    });

    expect(result).toEqual({ success: false, error: 'FinanceProfile não encontrado' });
  });

  it('retorna erro se AsaasAccount não encontrado', async () => {
    mockFindUniqueAccount.mockResolvedValue(null);

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    });

    expect(result).toEqual({ success: false, error: 'AsaasAccount não encontrado' });
  });
});

describe('handleAccountWebhook — commercial info cache refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindUniqueProfile.mockResolvedValue({ id: 'prof-1' });
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'IN_PROGRESS',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });
  });

  it('faz refresh de cache em evento COMMERCIAL_INFO_EXPIRED', async () => {
    const { getMyAccountStatus } = await import('@alusa/asaas');
    vi.mocked(getMyAccountStatus).mockResolvedValueOnce({
      general: 'APPROVED',
      documentation: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      commercialInfo: 'APPROVED',
      commercialInfoExpiration: { isExpired: true, scheduledDate: '2026-04-01' },
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
      payloadId: 'evt-ci-1',
    });

    expect(result.success).toBe(true);
    expect(mockUpdateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commercialInfoStatus: 'EXPIRED',
          commercialInfoScheduledDate: '2026-04-01',
        }),
      }),
    );

    const { getMyAccountDocuments } = await import('@alusa/asaas');
    expect(vi.mocked(getMyAccountStatus)).toHaveBeenCalled();
    expect(vi.mocked(getMyAccountDocuments)).toHaveBeenCalled();
  });

  it('faz refresh de cache em evento COMMERCIAL_INFO_EXPIRING_SOON', async () => {
    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
      payloadId: 'evt-ci-2',
    });

    expect(result.success).toBe(true);

    const { getMyAccountStatus, getMyAccountDocuments } = await import('@alusa/asaas');
    expect(vi.mocked(getMyAccountStatus)).toHaveBeenCalled();
    expect(vi.mocked(getMyAccountDocuments)).toHaveBeenCalled();
  });

  it('retorna sucesso mesmo se refresh de cache falha', async () => {
    const { getMyAccountStatus } = await import('@alusa/asaas');
    vi.mocked(getMyAccountStatus).mockRejectedValueOnce(new Error('API timeout'));

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
      payloadId: 'evt-ci-3',
    });

    expect(result.success).toBe(true);
  });
});
