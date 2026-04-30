import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alusa/asaas', async () => {
  return {
    createSubaccount: vi.fn(async () => ({
      object: 'account',
      id: 'acc_123',
      name: 'Conta Teste',
      email: 'test@test.com',
      cpfCnpj: '11144477735',
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    createSubaccountAccessToken: vi.fn(async () => ({
      id: 'token_1',
      apiKey: '$aact_sub_123',
    })),
    listSubaccounts: vi.fn(async () => ({
      data: [],
      hasMore: false,
      totalCount: 0,
      limit: 10,
      offset: 0,
      object: 'list',
    })),
    listSubaccountAccessTokens: vi.fn(async () => ({
      data: [],
      hasMore: false,
      totalCount: 0,
      limit: 100,
      offset: 0,
      object: 'list',
    })),
    updateSubaccount: vi.fn(),
    listWebhooks: vi.fn(async () => ({
      data: [
        {
          id: 'wh_1',
          name: 'Alusa - Webhook financeiro',
          url: 'https://app.alusa.com.br/api/webhooks/asaas',
          enabled: true,
          interrupted: true,
          hasAuthToken: true,
          sendType: 'SEQUENTIALLY',
          events: [
            'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
            'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
            'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
            'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
            'ACCOUNT_STATUS_DOCUMENT_APPROVED',
            'ACCOUNT_STATUS_DOCUMENT_REJECTED',
            'ACCOUNT_STATUS_DOCUMENT_PENDING',
            'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
            'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
            'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
            'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
            'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
            'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
            'PAYMENT_CREATED',
            'PAYMENT_UPDATED',
            'PAYMENT_CONFIRMED',
            'PAYMENT_RECEIVED',
            'PAYMENT_OVERDUE',
            'PAYMENT_REFUNDED',
            'PAYMENT_DELETED',
            'PAYMENT_RESTORED',
            'SUBSCRIPTION_CREATED',
            'SUBSCRIPTION_UPDATED',
            'SUBSCRIPTION_INACTIVATED',
            'SUBSCRIPTION_DELETED',
            'TRANSFER_CREATED',
            'TRANSFER_PENDING',
            'TRANSFER_IN_BANK_PROCESSING',
            'TRANSFER_DONE',
            'TRANSFER_FAILED',
            'TRANSFER_CANCELLED',
            'TRANSFER_BLOCKED',
          ],
        },
      ],
    })),
    updateWebhook: vi.fn(async () => ({
      id: 'wh_1',
      url: 'https://app.alusa.com.br/api/webhooks/asaas',
      enabled: true,
      interrupted: false,
    })),
    getMyAccountStatus: vi.fn(async () => ({ general: 'APPROVED' })),
  };
});

vi.mock('@alusa/database', async () => {
  return {
    prisma: {
      financeProfile: {
        findUnique: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      asaasAccount: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      asaasCredential: {
        createMany: vi.fn(),
        upsert: vi.fn(),
      },
      conta: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      usuario: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const { prisma } = await import('@alusa/database');
        return fn(prisma);
      }),
      $queryRawUnsafe: vi.fn(async () => [{ locked: true }]),
    },
    loadAsaasCredentials: vi.fn(),
  };
});

vi.mock('../../foundation/audit-log.service', async () => {
  return {
    auditLogService: { record: vi.fn(async () => ({ id: 'a1' })) },
  };
});

vi.mock('../../foundation/credential-vault', async () => {
  return {
    credentialVault: {
      encrypt: vi.fn((v: string) => `encrypted:${v}`),
      decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
    },
  };
});

vi.mock('../../foundation/asaas-api-key', async () => {
  return {
    validateSubaccountApiKey: vi.fn(async () => 'CONNECTED'),
  };
});

vi.mock('../../foundation/finance-profile.service', async () => {
  return {
    financeProfileService: {
      getOrCreateByTenant: vi.fn(async () => ({ id: 'fp1' })),
      setOnboardingData: vi.fn(),
    },
  };
});

import { createAsaasAccount } from '../asaas-account/create-asaas-account';

describe('createAsaasAccount - idempotência', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.ASAAS_API_KEY = 'master_key';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.alusa.com.br';
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'test-webhook-secret';

    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      ownerUserId: 'u1',
    } as never);
    vi.mocked(prisma.usuario.findUnique).mockResolvedValue({
      email: 'owner@test.com',
      birthDate: new Date('1990-01-01'),
    } as never);
  });

  it('deve retornar conta existente sem criar nova quando já está conectada', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubaccount, updateWebhook } = await import('@alusa/asaas');
    const { loadAsaasCredentials } = await import('@alusa/database');

    vi.mocked(loadAsaasCredentials).mockResolvedValue({
      apiKey: '$aact_sub_existing',
      webhookSecret: null,
      apiKeyStatus: 'CONNECTED',
      source: 'asaasAccount',
    });

    // Mock: conta já existe e está conectada
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({
      id: 'aa1',
      asaasAccountId: 'acc_existing',
      status: 'UNDER_REVIEW',
      apiKeyEncrypted: 'encrypted:$aact_sub_existing',
      apiKeyStatus: 'CONNECTED',
      webhookAuthTokenHash: 'hash123',
    } as never);

    const result = await createAsaasAccount({
      contaId: 'c1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.asaasAccountId).toBe('acc_existing');
    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);

    // Não deve chamar createSubaccount
    expect(vi.mocked(createSubaccount)).not.toHaveBeenCalled();
    expect(vi.mocked(updateWebhook)).toHaveBeenCalledTimes(1);
  });

  it('deve criar conta quando não existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubaccount } = await import('@alusa/asaas');

    // Mock: não existe conta
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue(null);

    // Mock: dados necessários para criar
    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValue({
      id: 'fp1',
      asaasOwnerName: 'Owner Name',
      asaasCompanyName: null,
      asaasName: 'Owner Name',
      mobilePhone: '11999999999',
      incomeValue: 5000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001000',
      complement: null,
      companyType: null,
    } as never);

    vi.mocked(prisma.conta.findUnique).mockResolvedValue({
      cpfCnpj: '11144477735',
      ownerUserId: 'u1',
      enderecoLogradouro: null,
      enderecoNumero: null,
      enderecoBairro: null,
      enderecoCep: null,
    } as never);

    vi.mocked(prisma.usuario.findUnique).mockResolvedValue({
      email: 'owner@test.com',
      birthDate: new Date('1990-01-01'),
    } as never);

    vi.mocked(prisma.asaasAccount.upsert).mockResolvedValue({
      id: 'aa1',
      asaasAccountId: 'acc_123',
      status: 'CREATED',
    } as never);

    vi.mocked(prisma.asaasAccount.create).mockResolvedValue({
      id: 'aa1',
    } as never);

    const result = await createAsaasAccount({
      contaId: 'c1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.asaasAccountId).toBe('acc_123');
    expect(result.created).toBe(true);

    // Deve chamar createSubaccount com idempotencyKey
    expect(vi.mocked(createSubaccount)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSubaccount).mock.calls[0]?.[0]).toHaveProperty('idempotencyKey');
  });

  it('chamadas paralelas devem resultar em uma única criação (via lock)', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubaccount } = await import('@alusa/asaas');

    // Simular que a primeira chamada não encontra conta, mas a segunda encontra (após lock)
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.asaasAccount.findUnique as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Primeira verificação (antes do lock): não existe
        return null;
      }
      // Segunda verificação (após lock): já existe (criada pela primeira chamada)
      return {
        id: 'aa1',
        asaasAccountId: 'acc_123',
        status: 'CREATED',
        apiKeyEncrypted: 'encrypted:$aact_sub_123',
        apiKeyStatus: 'CONNECTED',
      };
    });

    // Mock para falhar no lock na segunda chamada
    let lockCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRawUnsafe as any).mockImplementation(async () => {
      lockCount++;
      // Primeira chamada adquire lock, segunda não
      return [{ locked: lockCount === 1 }];
    });

    // Executar duas chamadas "paralelas" (simuladas)
    const [result1, result2] = await Promise.all([
      createAsaasAccount({ contaId: 'c1' }),
      createAsaasAccount({ contaId: 'c1' }),
    ]);

    // Pelo menos uma deve ser idempotente
    const idempotentResults = [result1, result2].filter(r => r.idempotent);
    expect(idempotentResults.length).toBeGreaterThanOrEqual(1);

    // createSubaccount deve ser chamado no máximo 1 vez
    // (pode ser 0 se ambas encontrarem a conta existente)
    expect(vi.mocked(createSubaccount).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('deve retornar snapshot quando lock não é adquirido e subconta já existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubaccount } = await import('@alusa/asaas');

    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({
      id: 'aa1',
      asaasAccountId: 'acc_existing',
      status: 'UNDER_REVIEW',
      apiKeyEncrypted: null,
      apiKeyStatus: 'MISSING',
    } as never);

    (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: false }]);

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_existing');
    expect(result.status).toBe('UNDER_REVIEW');
    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(vi.mocked(createSubaccount)).not.toHaveBeenCalled();
  });
});
