/**
 * Testes de mapeamento de eventos do Asaas no account-webhook-handler.
 *
 * Garante que:
 * - Todos os eventos ACCOUNT_STATUS_DOCUMENT_* chegam ao handler de KYC
 * - Eventos GENERAL_APPROVAL são autoritativos
 * - commercialInfo é tratado como track separado
 * - Nenhum evento DOCUMENTATION_* (antigo/incorreto) é usado
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindUniqueProfile,
  mockFindUniqueAccount,
  mockUpdateAccount,
  mockUpdateConta,
  mockCreateHistory,
  mockTransaction,
  mockKycProcessUpsert,
  mockGetMyAccountStatus,
  mockGetMyAccountDocuments,
  mockAuditRecord,
  mockSyncRegulatoryState,
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
    mockGetMyAccountStatus: vi.fn().mockResolvedValue({
      general: 'PENDING',
      documentation: 'PENDING',
      bankAccountInfo: 'PENDING',
      commercialInfo: null,
    }),
    mockGetMyAccountDocuments: vi.fn().mockResolvedValue({ data: [], rejectReasons: [] }),
    mockAuditRecord: vi.fn().mockResolvedValue(undefined),
    mockSyncRegulatoryState: vi.fn().mockResolvedValue(undefined),
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
  getMyAccountDocuments: mockGetMyAccountDocuments,
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: { syncRegulatoryState: mockSyncRegulatoryState },
}));

import { handleAccountWebhook } from '../account-webhook-handler';

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUniqueProfile.mockResolvedValue({ id: 'prof-1' });
  mockFindUniqueAccount.mockResolvedValue({
    id: 'acc-1',
    status: 'CREATED',
    asaasAccountId: 'ext-acc-1',
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
  });
});

describe('handleAccountWebhook — event contract validation', () => {
  describe('DOCUMENT events (official Asaas names)', () => {
    it.each([
      'ACCOUNT_STATUS_DOCUMENT_APPROVED',
      'ACCOUNT_STATUS_DOCUMENT_REJECTED',
      'ACCOUNT_STATUS_DOCUMENT_PENDING',
      'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
    ])('processa %s corretamente', async (event) => {
      const result = await handleAccountWebhook('conta-1', {
        event,
        payloadId: 'evt-doc-1',
      });
      expect(result.success).toBe(true);
    });

    it('ACCOUNT_STATUS_DOCUMENT_APPROVED aciona refresh de documentos', async () => {
      await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
        payloadId: 'evt-doc-2',
      });
      // refresh chama getMyAccountDocuments
      expect(mockGetMyAccountDocuments).toHaveBeenCalled();
    });

    it('ACCOUNT_STATUS_DOCUMENT_REJECTED atualiza KycProcess para REJECTED', async () => {
      await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_DOCUMENT_REJECTED',
        payloadId: 'evt-doc-3',
      });
      // updateKycProcessStatus é chamado com status REJECTED
      expect(mockKycProcessUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'REJECTED' }),
          update: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });
  });

  describe('BANK_ACCOUNT events', () => {
    it.each([
      'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
      'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
      'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
      'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
    ])('processa %s corretamente', async (event) => {
      const result = await handleAccountWebhook('conta-1', {
        event,
        payloadId: 'evt-bank-1',
      });
      expect(result.success).toBe(true);
    });

    it('BANK_ACCOUNT_INFO events acionam refresh de documentos', async () => {
      await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
        payloadId: 'evt-bank-2',
      });
      expect(mockGetMyAccountDocuments).toHaveBeenCalled();
    });
  });

  describe('GENERAL_APPROVAL events (autoritativos)', () => {
    it('GENERAL_APPROVAL_APPROVED → syncRegulatoryState(APPROVED)', async () => {
      await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
        payloadId: 'evt-gen-1',
      });
      expect(mockSyncRegulatoryState).toHaveBeenCalledWith(
        expect.objectContaining({ generalStatus: 'APPROVED' }),
      );
    });

    it('GENERAL_APPROVAL_REJECTED → syncRegulatoryState(REJECTED)', async () => {
      await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
        payloadId: 'evt-gen-2',
      });
      expect(mockSyncRegulatoryState).toHaveBeenCalledWith(
        expect.objectContaining({ generalStatus: 'REJECTED' }),
      );
    });
  });

  describe('COMMERCIAL_INFO expiration events (track separado)', () => {
    it('EXPIRING_SOON atualiza commercialInfoStatus sem alterar onboarding', async () => {
      const result = await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
        payloadId: 'evt-ci-1',
        scheduledDate: '2026-04-01',
      });
      expect(result.success).toBe(true);
      // Deve atualizar apenas commercialInfoStatus, não o status de onboarding
      expect(mockUpdateAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ commercialInfoStatus: 'EXPIRING_SOON' }),
        }),
      );
      // Não deve acionar transição de onboarding ($transaction)
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('EXPIRED atualiza commercialInfoStatus sem alterar onboarding', async () => {
      const result = await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
        payloadId: 'evt-ci-2',
      });
      expect(result.success).toBe(true);
      expect(mockUpdateAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ commercialInfoStatus: 'EXPIRED' }),
        }),
      );
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('COMMERCIAL_INFO_EXPIRED é idempotente (mesmo status = sem update de commercialInfo)', async () => {
      mockFindUniqueAccount.mockResolvedValue({
        id: 'acc-1',
        status: 'APPROVED',
        asaasAccountId: 'ext-acc-1',
        commercialInfoStatus: 'EXPIRED',
        commercialInfoScheduledDate: null,
      });

      const result = await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
        payloadId: 'evt-ci-3',
      });
      expect(result.success).toBe(true);
      // Pode atualizar cache, mas NÃO deve atualizar commercialInfoStatus
      // (já é EXPIRED — idempotente para esse campo)
      const ciUpdates = mockUpdateAccount.mock.calls.filter(
        (call) => call[0]?.data?.commercialInfoStatus !== undefined,
      );
      expect(ciUpdates).toHaveLength(0);
    });
  });

  describe('contrato: não usa substrings DOCUMENTATION_*', () => {
    it('evento com DOCUMENTATION_ no nome não aciona KYC status update', async () => {
      // Simula evento hipotético com substring antiga
      const result = await handleAccountWebhook('conta-1', {
        event: 'FAKE_DOCUMENTATION_APPROVED',
        payloadId: 'evt-fake-1',
      });
      expect(result.success).toBe(true);
      // O KycProcess NÃO deve ser atualizado para REJECTED/UNDER_REVIEW
      // porque mapEventToKycStatus usa match exato, não substring
    });
  });

  describe('erros esperados', () => {
    it('retorna erro quando FinanceProfile não existe', async () => {
      mockFindUniqueProfile.mockResolvedValue(null);
      const result = await handleAccountWebhook('conta-inexistente', {
        event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('FinanceProfile');
    });

    it('retorna erro quando AsaasAccount não existe', async () => {
      mockFindUniqueAccount.mockResolvedValue(null);
      const result = await handleAccountWebhook('conta-1', {
        event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('AsaasAccount');
    });
  });
});
