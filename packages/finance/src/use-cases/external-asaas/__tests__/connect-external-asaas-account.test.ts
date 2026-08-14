import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMyAccountStatus: vi.fn(),
  getMyAccountCommercialInfo: vi.fn(),
  getMyAccountDocuments: vi.fn(),
  syncKycModels: vi.fn(),
  ensureWebhook: vi.fn(),
  getOrCreateByTenant: vi.fn(),
  asaasAccountFindUnique: vi.fn(),
  asaasAccountUpsert: vi.fn(),
  asaasAccountUpdate: vi.fn(),
  asaasAccountUpdateMany: vi.fn(),
  contaUpdate: vi.fn(),
  financeProfileUpdate: vi.fn(),
  credentialUpsert: vi.fn(),
  historyCreate: vi.fn(),
  transaction: vi.fn(),
  auditRecord: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  getMyAccountStatus: mocks.getMyAccountStatus,
  getMyAccountCommercialInfo: mocks.getMyAccountCommercialInfo,
  getMyAccountDocuments: mocks.getMyAccountDocuments,
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: {
      findUnique: mocks.asaasAccountFindUnique,
      upsert: mocks.asaasAccountUpsert,
      update: mocks.asaasAccountUpdate,
      updateMany: mocks.asaasAccountUpdateMany,
    },
    conta: { update: mocks.contaUpdate },
    financeProfile: { update: mocks.financeProfileUpdate },
    asaasCredential: { upsert: mocks.credentialUpsert },
    asaasAccountStatusHistory: { create: mocks.historyCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: { getOrCreateByTenant: mocks.getOrCreateByTenant },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: mocks.auditRecord },
}));

vi.mock('../../../foundation/credential-vault', () => ({
  credentialVault: { encrypt: mocks.encrypt },
}));

vi.mock('../../../webhooks/ensure-asaas-webhook-configuration', () => ({
  AsaasWebhookConfigurationError: class AsaasWebhookConfigurationError extends Error {
    constructor(
      public code: string,
      public stage: string,
      message: string,
    ) {
      super(message);
    }
  },
  ensureAsaasWebhookConfiguration: mocks.ensureWebhook,
}));

vi.mock('../../kyc/kyc-persistence.service', () => ({
  syncKycModels: mocks.syncKycModels,
}));

import { connectExternalAsaasAccount } from '../connect-external-asaas-account';

describe('connectExternalAsaasAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyAccountStatus.mockResolvedValue({ id: 'acc_external_1', general: 'APPROVED' });
    mocks.getMyAccountCommercialInfo.mockResolvedValue({ email: 'financeiro@escola.com' });
    mocks.getMyAccountDocuments.mockResolvedValue({ data: [], rejectReasons: [] });
    mocks.syncKycModels.mockResolvedValue(undefined);
    mocks.getOrCreateByTenant.mockResolvedValue({ id: 'profile_1' });
    mocks.asaasAccountFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.asaasAccountUpsert.mockResolvedValue({ id: 'local_account_1' });
    mocks.asaasAccountUpdate.mockResolvedValue({ id: 'local_account_1' });
    mocks.asaasAccountUpdateMany.mockResolvedValue({ count: 1 });
    mocks.contaUpdate.mockResolvedValue({ id: 'conta_1' });
    mocks.financeProfileUpdate.mockResolvedValue({ id: 'profile_1' });
    mocks.credentialUpsert.mockResolvedValue({ id: 'credential_1' });
    mocks.historyCreate.mockResolvedValue({ id: 'history_1' });
    mocks.encrypt.mockReturnValue('encrypted_new_key');
    mocks.ensureWebhook.mockResolvedValue({
      webhookId: 'wh_1',
      action: 'created',
      authTokenHash: 'hash_1',
      eventsCount: 111,
      duplicateWebhookIdsRemoved: [],
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        conta: { update: mocks.contaUpdate },
        financeProfile: { update: mocks.financeProfileUpdate },
        asaasAccount: {
          update: mocks.asaasAccountUpdate,
          updateMany: mocks.asaasAccountUpdateMany,
        },
        asaasCredential: { upsert: mocks.credentialUpsert },
        asaasAccountStatusHistory: { create: mocks.historyCreate },
      }),
    );
  });

  it('só promove a credencial depois de confirmar o webhook remoto', async () => {
    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      cpfCnpj: '12.345.678/0001-99',
      phone: '(11) 99999-9999',
      apiKey: '$aact_hmlg_valid_external_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(mocks.ensureWebhook).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta_1',
      financeProfileId: 'profile_1',
      persistResult: false,
      forceAuthTokenRefresh: true,
    }));
    expect(mocks.ensureWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.encrypt.mock.invocationCallOrder[0]!,
    );
    expect(mocks.credentialUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { apiKeyEncrypted: 'encrypted_new_key' },
    }));
    expect(mocks.asaasAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        asaasAccountId: 'acc_external_1',
        webhookId: 'wh_1',
        webhookStatus: 'ACTIVE',
        apiKeyStatus: 'CONNECTED',
        operationalStatus: 'OPERATIONAL',
      }),
    }));
    expect(result).toMatchObject({ success: true, status: 'READY', webhookAction: 'created' });
  });

  it('não marca como operacional uma conta Asaas ainda pendente', async () => {
    mocks.getMyAccountStatus.mockResolvedValueOnce({ id: 'acc_external_pending', general: 'PENDING' });

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Em Análise',
      apiKey: '$aact_hmlg_pending_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toMatchObject({ success: true, status: 'READY' });
    expect(mocks.asaasAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'UNDER_REVIEW',
        operationalStatus: 'KYC_PENDING',
        apiKeyStatus: 'CONNECTED',
        webhookStatus: 'ACTIVE',
      }),
    }));
  });

  it('preserva a credencial anterior quando a substituição falha no Asaas', async () => {
    mocks.asaasAccountFindUnique.mockReset();
    mocks.asaasAccountFindUnique
      .mockResolvedValueOnce({
        id: 'local_account_1',
        asaasAccountId: 'acc_external_1',
        apiKeyEncrypted: 'encrypted_old_key',
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
        provisionedAt: new Date('2026-01-01'),
        webhookStatus: 'ACTIVE',
        operationalStatus: 'OPERATIONAL',
      })
      .mockResolvedValueOnce({
        id: 'local_account_1',
        financeProfileId: 'profile_1',
        financeProfile: { contaId: 'conta_1' },
      });
    const remoteError = Object.assign(new Error('asaas unavailable'), { status: 503 });
    mocks.ensureWebhook.mockRejectedValueOnce(remoteError);

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      apiKey: '$aact_hmlg_replacement_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'TEMPORARY_ASAAS_ERROR',
      retryable: true,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.credentialUpsert).not.toHaveBeenCalled();
    expect(mocks.contaUpdate).not.toHaveBeenCalled();
  });

  it('não persiste a nova API key quando a primeira configuração do webhook falha', async () => {
    mocks.ensureWebhook.mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 503 }));

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      apiKey: '$aact_hmlg_first_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toMatchObject({ success: false, errorCode: 'TEMPORARY_ASAAS_ERROR' });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.credentialUpsert).not.toHaveBeenCalled();
    expect(mocks.asaasAccountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        webhookStatus: 'PENDING',
        operationalStatus: 'WEBHOOK_REQUIRED',
      }),
    }));
  });

  it('permite substituir a conta Asaas local quando a nova conta não pertence a outro tenant', async () => {
    mocks.asaasAccountFindUnique.mockReset();
    mocks.asaasAccountFindUnique
      .mockResolvedValueOnce({
        id: 'local_account_1',
        asaasAccountId: 'acc_original',
        apiKeyEncrypted: 'encrypted_old_key',
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      })
      .mockResolvedValueOnce(null);

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      apiKey: '$aact_hmlg_other_account_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toMatchObject({ success: true, status: 'READY' });
    expect(mocks.ensureWebhook).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: '$aact_hmlg_other_account_key',
      persistResult: false,
    }));
    expect(mocks.asaasAccountUpsert).not.toHaveBeenCalled();
    expect(mocks.asaasAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ asaasAccountId: 'acc_external_1' }),
    }));
  });

  it('preserva a conta antiga quando a reconexão de uma conta substituta falha', async () => {
    mocks.asaasAccountFindUnique.mockReset();
    mocks.asaasAccountFindUnique
      .mockResolvedValueOnce({
        id: 'local_account_1',
        asaasAccountId: 'acc_original',
        apiKeyEncrypted: 'encrypted_old_key',
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
        provisionedAt: new Date('2026-01-01'),
        webhookStatus: 'ACTIVE',
        operationalStatus: 'OPERATIONAL',
      })
      .mockResolvedValueOnce(null);
    mocks.ensureWebhook.mockRejectedValueOnce(Object.assign(new Error('asaas unavailable'), { status: 503 }));

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      apiKey: '$aact_hmlg_replacement_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toMatchObject({ success: false, errorCode: 'TEMPORARY_ASAAS_ERROR' });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.credentialUpsert).not.toHaveBeenCalled();
    expect(mocks.asaasAccountUpdate).not.toHaveBeenCalled();
  });

  it('bloqueia vínculo cross-tenant antes de provisionar o webhook', async () => {
    mocks.asaasAccountFindUnique.mockReset();
    mocks.asaasAccountFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'account_tenant_b',
        financeProfileId: 'profile_b',
        financeProfile: { contaId: 'conta_b' },
      });

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_a',
      schoolName: 'Escola A',
      apiKey: '$aact_hmlg_tenant_b_key',
      actor: { type: 'ADMIN', id: 'user_a' },
    });

    expect(result).toMatchObject({ success: false, errorCode: 'ACCOUNT_ALREADY_LINKED' });
    expect(mocks.ensureWebhook).not.toHaveBeenCalled();
    expect(mocks.asaasAccountUpsert).not.toHaveBeenCalled();
  });

  it('persiste o estado regulatório real retornado pelo Asaas', async () => {
    mocks.getMyAccountStatus.mockResolvedValueOnce({
      id: 'acc_external_1',
      general: 'AWAITING_APPROVAL',
    });

    await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Em Análise',
      apiKey: '$aact_hmlg_valid_external_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(mocks.contaUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ financeStatus: 'FINANCE_IN_ANALYSIS' }),
    }));
    expect(mocks.financeProfileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(mocks.asaasAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'UNDER_REVIEW' }),
    }));
  });
});
