import { describe, expect, it, vi, beforeEach } from 'vitest';

// ================================================================================
// Mocks - devem vir antes dos imports
// ================================================================================

const {
  mockCreateSubaccount,
  mockCreateSubaccountAccessToken,
  mockListSubaccounts,
  mockListSubaccountAccessTokens,
  mockAsaasAccountUpdate,
  mockAsaasAccountFindUnique,
  mockAsaasAccountUpsert,
} = vi.hoisted(() => ({
  mockCreateSubaccount: vi.fn(),
  mockCreateSubaccountAccessToken: vi.fn(),
  mockListSubaccounts: vi.fn(),
  mockListSubaccountAccessTokens: vi.fn(),
  mockAsaasAccountUpdate: vi.fn(async () => ({ id: 'aa1' })),
  mockAsaasAccountFindUnique: vi.fn(),
  mockAsaasAccountUpsert: vi.fn(async (args) => ({
    id: 'aa1',
    asaasAccountId: args.create.asaasAccountId,
    status: args.create.status,
  })),
}));

vi.mock('@alusa/asaas', async () => {
  return {
    createSubaccount: mockCreateSubaccount,
    createSubaccountAccessToken: mockCreateSubaccountAccessToken,
    listSubaccounts: mockListSubaccounts,
    listSubaccountAccessTokens: mockListSubaccountAccessTokens,
    updateSubaccount: vi.fn(),
    getMyAccountStatus: vi.fn(async () => ({ general: 'APPROVED' })),
  };
});

vi.mock('@alusa/database', async () => {
  return {
    prisma: {
      financeProfile: {
        findUnique: vi.fn(async () => ({
          id: 'fp1',
          asaasName: 'Test Owner',
          asaasOwnerName: 'Test Owner',
          asaasLoginEmail: 'login@test.com',
          asaasPhone: null,
          asaasSite: null,
          mobilePhone: '11999998888',
          incomeValue: 5000,
          address: 'Rua Teste',
          addressNumber: '123',
          province: 'Centro',
          postalCode: '01234567',
          complement: null,
          companyType: null,
        })),
        update: vi.fn(async () => ({ id: 'fp1' })),
        upsert: vi.fn(async () => ({ id: 'fp1' })),
      },
      asaasAccount: {
        findUnique: mockAsaasAccountFindUnique,
        create: vi.fn(async () => ({ id: 'aa1' })),
        update: mockAsaasAccountUpdate,
        upsert: mockAsaasAccountUpsert,
      },
      asaasCredential: {
        createMany: vi.fn(),
        upsert: vi.fn(),
      },
      conta: {
        findUnique: vi.fn(async () => ({
          id: 'c1',
          cpfCnpj: '12345678909',
          ownerUserId: 'u1',
          enderecoLogradouro: null,
          enderecoNumero: null,
          enderecoBairro: null,
          enderecoCep: null,
        })),
      },
      usuario: {
        findUnique: vi.fn(async () => ({
          email: 'owner@test.com',
          birthDate: new Date('1990-01-15'),
        })),
        findFirst: vi.fn(),
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

// ================================================================================
// Testes
// ================================================================================

describe('createAsaasAccount - timeout e recovery', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.ASAAS_API_KEY = 'master_key';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.alusa.com.br';
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'test-webhook-secret';
    delete process.env.ASAAS_ACCESS_TOKEN_RECOVERY_ENABLED;

    // Default: subconta não existe
    mockAsaasAccountFindUnique.mockResolvedValue(null);
    mockListSubaccounts.mockResolvedValue({ data: [] });
    mockListSubaccountAccessTokens.mockResolvedValue({ data: [] });
  });

  it('deve reaproveitar subconta remota já existente antes de tentar novo POST', async () => {
    mockListSubaccounts.mockResolvedValueOnce({
      data: [
        {
          id: 'acc_existing',
          email: 'owner@test.com',
          loginEmail: 'owner@test.com',
          cpfCnpj: '12345678909',
          name: 'Conta Existente',
        },
      ],
    });

    mockCreateSubaccountAccessToken.mockResolvedValueOnce({
      id: 'token_existing',
      apiKey: '$aact_existing_key',
    });

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_existing');
    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockListSubaccounts).toHaveBeenCalledTimes(1);
  });

  it('deve reconciliar subconta legada criada com email aliasado (retrocompatibilidade)', async () => {
    // Subconta legada com email +alusa-{id} no Asaas
    mockListSubaccounts.mockResolvedValueOnce({
      data: [
        {
          id: 'acc_legacy',
          email: 'owner+alusa-c1@test.com',
          loginEmail: 'owner+alusa-c1@test.com',
          cpfCnpj: '12345678909',
          name: 'Conta Legada',
        },
      ],
    });

    mockCreateSubaccountAccessToken.mockResolvedValueOnce({
      id: 'token_legacy',
      apiKey: '$aact_legacy_key',
    });

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_legacy');
    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
  });

  it('deve recuperar subconta após timeout quando ela foi criada no provedor', async () => {
    // Simula timeout na criação
    const timeoutError = new Error('network timeout');
    (timeoutError as unknown as { code: string }).code = 'ETIMEDOUT';
    mockCreateSubaccount.mockRejectedValueOnce(timeoutError);

    // Recovery encontra subconta criada
    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc_recovered',
            email: 'owner@test.com',
            loginEmail: 'owner@test.com',
            cpfCnpj: '12345678909',
            name: 'Conta Recuperada',
          },
        ],
      });

    // Access token para obter apiKey
    mockCreateSubaccountAccessToken.mockResolvedValueOnce({
      id: 'token_1',
      apiKey: '$aact_recovered_key',
    });

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_recovered');
    expect(result.created).toBe(true);
    expect(result.requiresManualApiKeyRecovery).toBe(true);
    expect(mockListSubaccounts).toHaveBeenCalledTimes(2);
    expect(mockCreateSubaccountAccessToken).not.toHaveBeenCalled();
  });

  it('deve propagar erro se recovery não encontrar subconta', async () => {
    const timeoutError = new Error('connection reset');
    (timeoutError as unknown as { code: string }).code = 'ECONNRESET';
    mockCreateSubaccount.mockRejectedValueOnce(timeoutError);

    // Recovery não encontra subconta
    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    await expect(createAsaasAccount({ contaId: 'c1' })).rejects.toThrow('connection reset');
    expect(mockListSubaccounts).toHaveBeenCalledTimes(2);
  });

  it('NÃO deve tentar recovery para erros 4xx (determinísticos)', async () => {
    const badRequestError = new Error('CPF inválido');
    (badRequestError as unknown as { status: number }).status = 400;
    mockCreateSubaccount.mockRejectedValueOnce(badRequestError);

    await expect(createAsaasAccount({ contaId: 'c1' })).rejects.toThrow('CPF inválido');
    expect(mockListSubaccounts).toHaveBeenCalledTimes(1);
  });

  it('deve tentar recovery para erros 5xx', async () => {
    const serverError = new Error('Internal server error');
    (serverError as unknown as { status: number }).status = 500;
    mockCreateSubaccount.mockRejectedValueOnce(serverError);

    // Recovery não encontra
    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    await expect(createAsaasAccount({ contaId: 'c1' })).rejects.toThrow('Internal server error');
    expect(mockListSubaccounts).toHaveBeenCalledTimes(2);
  });

  it('deve reconciliar conflito 409 quando a subconta já existe remotamente', async () => {
    const conflictError = new Error('Conta já cadastrada');
    (conflictError as unknown as { status: number }).status = 409;
    mockCreateSubaccount.mockRejectedValueOnce(conflictError);

    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc_conflict',
            email: 'owner@test.com',
            loginEmail: 'owner@test.com',
            cpfCnpj: '12345678909',
            name: 'Conta Conflito',
          },
        ],
      });
    mockCreateSubaccountAccessToken.mockResolvedValueOnce({
      id: 'token_conflict',
      apiKey: '$aact_conflict_key',
    });

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_conflict');
    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(mockListSubaccounts).toHaveBeenCalledTimes(2);
  });

  it('deve registrar tentativas e erro no banco', async () => {
    mockAsaasAccountFindUnique.mockResolvedValue({
      id: 'aa1',
      asaasAccountId: null,
      status: 'IN_PROGRESS',
      apiKeyEncrypted: null,
      apiKeyStatus: 'MISSING',
      webhookAuthTokenHash: null,
    });

    const timeoutError = new Error('timeout');
    (timeoutError as unknown as { code: string }).code = 'ETIMEDOUT';
    mockCreateSubaccount.mockRejectedValueOnce(timeoutError);
    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    await expect(createAsaasAccount({ contaId: 'c1' })).rejects.toThrow();

    // Deve ter registrado tentativa de provisionamento no placeholder
    expect(mockAsaasAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          provisionAttempts: { increment: 1 },
        }),
      }),
    );

    // Deve ter registrado o erro
    expect(mockAsaasAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provisionLastError: expect.any(String),
        }),
      }),
    );
  });

  it('deve funcionar normalmente quando não há erro', async () => {
    mockCreateSubaccount.mockResolvedValueOnce({
      object: 'account',
      id: 'acc_success',
      name: 'Conta Nova',
      email: 'new@test.com',
      cpfCnpj: '12345678909',
      apiKey: '$aact_new_key',
      walletId: 'wallet-1',
    });

    const result = await createAsaasAccount({ contaId: 'c1' });

    expect(result.asaasAccountId).toBe('acc_success');
    expect(result.created).toBe(true);
    expect(mockListSubaccounts).toHaveBeenCalledTimes(1);
  });
});

describe('createAsaasAccount - observabilidade', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.ASAAS_API_KEY = 'master_key';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.alusa.com.br';

    mockAsaasAccountFindUnique.mockResolvedValue(null);
  });

  it('deve limpar provisionLastError após sucesso', async () => {
    mockCreateSubaccount.mockResolvedValueOnce({
      object: 'account',
      id: 'acc_success',
      name: 'Conta',
      email: 'test@test.com',
      cpfCnpj: '12345678909',
      apiKey: '$aact_key',
      walletId: 'wallet-1',
    });

    await createAsaasAccount({ contaId: 'c1' });

    expect(mockAsaasAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provisionLastError: null,
        }),
        update: expect.objectContaining({
          provisionLastError: null,
        }),
      }),
    );
  });

  it('deve truncar mensagens de erro longas', async () => {
    mockAsaasAccountFindUnique.mockResolvedValue({
      id: 'aa1',
      asaasAccountId: null,
      status: 'IN_PROGRESS',
      apiKeyEncrypted: null,
      apiKeyStatus: 'MISSING',
      webhookAuthTokenHash: null,
    });

    const longError = new Error('A'.repeat(1000));
    (longError as unknown as { code: string }).code = 'ETIMEDOUT';
    mockCreateSubaccount.mockRejectedValueOnce(longError);
    mockListSubaccounts
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });

    await expect(createAsaasAccount({ contaId: 'c1' })).rejects.toThrow();

    // Verifica que o erro foi truncado para <= 500 caracteres
    expect(mockAsaasAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provisionLastError: expect.stringMatching(/^A{1,500}$/),
        }),
      }),
    );
  });
});
