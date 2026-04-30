/**
 * Testes de monotonicidade de status no webhook handler.
 * Garante que eventos tardios não rebaixam APPROVED sem confirmação fresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  mockFindUniqueProfile,
  mockFindUniqueAccount,
  mockUpdateAccount,
  mockUpdateConta,
  mockTransaction,
  mockKycProcessUpsert,
  mockGetMyAccountStatus,
  mockAuditRecord,
} = vi.hoisted(() => {
  const mockUpdateAccount = vi.fn().mockResolvedValue({ id: 'acc-1' });
  const mockUpdateConta = vi.fn().mockResolvedValue({ id: 'conta-1' });
  const mockCreateHistory = vi.fn().mockResolvedValue({ id: 'hist-1' });

  return {
    mockFindUniqueProfile: vi.fn(),
    mockFindUniqueAccount: vi.fn(),
    mockUpdateAccount,
    mockUpdateConta,
    mockTransaction: vi.fn(async (fn: (_tx: unknown) => Promise<void>) => {
      await fn({
        asaasAccount: { update: mockUpdateAccount },
        asaasAccountStatusHistory: { create: mockCreateHistory },
        conta: { update: mockUpdateConta },
      });
    }),
    mockKycProcessUpsert: vi.fn().mockResolvedValue({ id: 'proc-1' }),
    mockGetMyAccountStatus: vi.fn(),
    mockAuditRecord: vi.fn().mockResolvedValue(undefined),
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
  getMyAccountStatus: mockGetMyAccountStatus,
  getMyAccountDocuments: vi.fn().mockResolvedValue({ data: [], rejectReasons: [] }),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: { syncRegulatoryState: vi.fn().mockResolvedValue(undefined) },
}));

import { handleAccountWebhook } from '../account-webhook-handler';

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUniqueProfile.mockResolvedValue({ id: 'prof-1' });
});

describe('handleAccountWebhook — status monotonicity', () => {
  it('bloqueia regressão APPROVED → UNDER_REVIEW por evento DOCUMENT tardio', async () => {
    // Estado atual: APPROVED
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'APPROVED',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    // Fresh status confirma APPROVED — downgrade não confirmado
    mockGetMyAccountStatus.mockResolvedValue({
      general: 'APPROVED',
      documentation: 'PENDING',
      bankAccountInfo: 'PENDING',
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENT_PENDING',
      payloadId: 'evt-late-1',
    });

    expect(result.success).toBe(true);

    // Status NÃO deve ter sido alterado (sem transação de update)
    expect(mockTransaction).not.toHaveBeenCalled();

    // Audit log registrou bloqueio
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.onboarding.downgrade_blocked',
        metadata: expect.objectContaining({
          currentStatus: 'APPROVED',
          incomingStatus: 'UNDER_REVIEW',
          reason: 'monotonicity_guard',
        }),
      }),
    );
  });

  it('permite regressão quando fresh status confirma não-APPROVED', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'APPROVED',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    // Fresh status mostra que realmente foi rebaixado
    mockGetMyAccountStatus.mockResolvedValue({
      general: 'PENDING',
      documentation: 'REJECTED',
      bankAccountInfo: 'PENDING',
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENTATION_REJECTED',
      payloadId: 'evt-real-1',
    });

    expect(result.success).toBe(true);
    // Transação DE FATO executada (status mudou)
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('permite evento GENERAL_APPROVAL_REJECTED mesmo sendo downgrade (autoritativo)', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'APPROVED',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
      payloadId: 'evt-auth-1',
    });

    expect(result.success).toBe(true);
    // Evento autoritativo — transação executada sem fresh check
    expect(mockTransaction).toHaveBeenCalled();
    // Não deve ter chamado getMyAccountStatus para confirmação
    expect(mockGetMyAccountStatus).not.toHaveBeenCalled();
  });

  it('mantém estado quando fetch fresh falha (conservador)', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'APPROVED',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    // Fresh fetch falha
    mockGetMyAccountStatus.mockRejectedValue(new Error('Asaas timeout'));

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENT_PENDING',
      payloadId: 'evt-fail-1',
    });

    expect(result.success).toBe(true);
    // Conservador: não rebaixa
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.onboarding.downgrade_blocked',
      }),
    );
  });

  it('não interfere em progressão normal (PENDING → UNDER_REVIEW)', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 'acc-1',
      status: 'PENDING',
      asaasAccountId: 'ext-acc-1',
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    });

    mockGetMyAccountStatus.mockResolvedValue({
      general: 'PENDING',
      documentation: 'PENDING',
      bankAccountInfo: 'PENDING',
    });

    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
      payloadId: 'evt-normal-1',
    });

    expect(result.success).toBe(true);
    // Progressão permitida sem fresh check
    expect(mockTransaction).toHaveBeenCalled();
  });
});
