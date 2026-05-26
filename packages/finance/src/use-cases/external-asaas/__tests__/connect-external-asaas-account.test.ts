import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getMyAccountStatusMock,
  getMyAccountCommercialInfoMock,
  listWebhooksMock,
  createWebhookMock,
  updateWebhookMock,
  contaUpdateMock,
  financeProfileUpdateMock,
  asaasAccountFindUniqueMock,
  asaasAccountUpsertMock,
  asaasCredentialUpsertMock,
  asaasAccountStatusHistoryCreateMock,
  transactionMock,
  getOrCreateByTenantMock,
  auditLogRecordMock,
  encryptMock,
} = vi.hoisted(() => ({
  getMyAccountStatusMock: vi.fn(),
  getMyAccountCommercialInfoMock: vi.fn(),
  listWebhooksMock: vi.fn(),
  createWebhookMock: vi.fn(),
  updateWebhookMock: vi.fn(),
  contaUpdateMock: vi.fn(),
  financeProfileUpdateMock: vi.fn(),
  asaasAccountFindUniqueMock: vi.fn(),
  asaasAccountUpsertMock: vi.fn(),
  asaasCredentialUpsertMock: vi.fn(),
  asaasAccountStatusHistoryCreateMock: vi.fn(),
  transactionMock: vi.fn(),
  getOrCreateByTenantMock: vi.fn(),
  auditLogRecordMock: vi.fn(),
  encryptMock: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  getMyAccountStatus: getMyAccountStatusMock,
  getMyAccountCommercialInfo: getMyAccountCommercialInfoMock,
  listWebhooks: listWebhooksMock,
  createWebhook: createWebhookMock,
  updateWebhook: updateWebhookMock,
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: {
      update: contaUpdateMock,
    },
    financeProfile: {
      update: financeProfileUpdateMock,
    },
    asaasAccount: {
      findUnique: asaasAccountFindUniqueMock,
      upsert: asaasAccountUpsertMock,
    },
    asaasCredential: {
      upsert: asaasCredentialUpsertMock,
    },
    asaasAccountStatusHistory: {
      create: asaasAccountStatusHistoryCreateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: getOrCreateByTenantMock,
  },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: auditLogRecordMock,
  },
}));

vi.mock('../../../foundation/credential-vault', () => ({
  credentialVault: {
    encrypt: encryptMock,
  },
}));

vi.mock('../../asaas-account/expected-webhook-config.server', () => ({
  buildExpectedWebhookConfig: vi.fn(() => ({
    name: 'Webhook Alusa',
    url: 'https://app.alusa.com/api/webhooks/asaas?tenant=profile_1',
    normalizedUrl: 'https://app.alusa.com/api/webhooks/asaas?tenant=profile_1',
    authToken: 'token_1',
    authTokenHash: 'hash_1',
    sendType: 'SEQUENTIALLY',
    events: ['PAYMENT_RECEIVED'],
  })),
  hasSameWebhookEvents: vi.fn(() => true),
  normalizeWebhookUrlBase: vi.fn((value: string) => value),
}));

import { connectExternalAsaasAccount } from '../connect-external-asaas-account';

describe('connectExternalAsaasAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getOrCreateByTenantMock.mockResolvedValue({ id: 'profile_1' });
    getMyAccountStatusMock.mockResolvedValue({ id: 'acc_external_1', general: 'APPROVED' });
    getMyAccountCommercialInfoMock.mockResolvedValue({ email: 'financeiro@escola.com' });
    listWebhooksMock.mockResolvedValue({ data: [] });
    createWebhookMock.mockResolvedValue({ id: 'wh_1' });
    encryptMock.mockReturnValue('encrypted_key');

    asaasAccountFindUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    asaasAccountUpsertMock.mockResolvedValue({ id: 'asaas_account_local_1' });
    asaasCredentialUpsertMock.mockResolvedValue({ id: 'cred_1' });
    asaasAccountStatusHistoryCreateMock.mockResolvedValue({ id: 'hist_1' });
    contaUpdateMock.mockResolvedValue({ id: 'conta_1' });
    financeProfileUpdateMock.mockResolvedValue({ id: 'profile_1' });

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        conta: { update: contaUpdateMock },
        financeProfile: { update: financeProfileUpdateMock },
        asaasAccount: { upsert: asaasAccountUpsertMock },
        asaasCredential: { upsert: asaasCredentialUpsertMock },
        asaasAccountStatusHistory: { create: asaasAccountStatusHistoryCreateMock },
      };

      return callback(tx);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('usa myAccount/status para id da conta e commercialInfo para email', async () => {
    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      cpfCnpj: '12.345.678/0001-99',
      phone: '(11) 99999-9999',
      apiKey: '$aact_hmlg_valid_external_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(getMyAccountStatusMock).toHaveBeenCalledWith({ apiKey: '$aact_hmlg_valid_external_key' });
    expect(getMyAccountCommercialInfoMock).toHaveBeenCalledWith({ apiKey: '$aact_hmlg_valid_external_key' });
    expect(createWebhookMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        status: 'READY',
        account: {
          asaasAccountId: 'acc_external_1',
          asaasEmail: 'financeiro@escola.com',
        },
      }),
    );
    expect(financeProfileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          asaasAccountId: 'acc_external_1',
          asaasLoginEmail: 'financeiro@escola.com',
        }),
      }),
    );
    expect(auditLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.external-asaas.connected',
        metadata: expect.objectContaining({
          asaasAccountId: 'acc_external_1',
          asaasEmail: 'financeiro@escola.com',
        }),
      }),
    );
  });

  it('não marca conta externa como operacional quando o webhook remoto fica pendente', async () => {
    createWebhookMock.mockRejectedValueOnce(new Error('webhook unavailable'));

    const result = await connectExternalAsaasAccount({
      contaId: 'conta_1',
      schoolName: 'Escola Externa',
      cpfCnpj: '12.345.678/0001-99',
      phone: '(11) 99999-9999',
      apiKey: '$aact_hmlg_valid_external_key',
      actor: { type: 'ADMIN', id: 'user_1' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        status: 'WEBHOOK_PENDING',
        webhookAction: 'pending',
      }),
    );

    expect(asaasAccountUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          webhookStatus: 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
        }),
        update: expect.objectContaining({
          webhookStatus: 'PENDING',
          operationalStatus: 'WEBHOOK_REQUIRED',
        }),
      }),
    );
  });
});
