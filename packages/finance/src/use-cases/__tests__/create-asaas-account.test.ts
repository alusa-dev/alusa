import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { financeProfileService } from '../../foundation/finance-profile.service';
import { credentialVault } from '../../foundation/credential-vault';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { MissingBirthDateError } from '../../errors/missing-birth-date-error';
import { MissingCompanyTypeError } from '../../errors/missing-company-type-error';
import { createAsaasAccount } from '../asaas-account/create-asaas-account';

const VALID_CPF = '11144477735';
const VALID_CNPJ = '11222333000181';

const subaccountId = `asaas-account-${randomUUID()}`;

vi.mock('@alusa/asaas', async () => {
  class AsaasHttpError extends Error {
    constructor(
      message: string,
      public status: number,
      public response?: unknown,
    ) {
      super(message);
      this.name = 'AsaasHttpError';
    }
  }

  return {
    AsaasHttpError,
    createSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CNPJ,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    getMyAccountStatus: vi.fn(async () => ({ general: 'PENDING' })),
    createSubaccountAccessToken: vi.fn(async () => ({
      object: 'accessToken',
      id: 'access-token-1',
      name: 'Alusa - API Key',
      apiKey: '$aact_sub_generated',
      enabled: true,
      dateCreated: new Date().toISOString(),
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
    listWebhooks: vi.fn(async () => ({
      data: [],
      hasMore: false,
      totalCount: 0,
      limit: 100,
      offset: 0,
      object: 'list',
    })),
    createWebhook: vi.fn(async () => ({ id: 'webhook-1' })),
    updateWebhook: vi.fn(async () => ({ id: 'webhook-1' })),
    updateSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CNPJ,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    getMyAccount: vi.fn(async () => ({ id: subaccountId })),
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY || '$aact_master_test';
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.alusa.com.br';
process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET ?? 'test-webhook-auth-token-secret';

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  await prisma.auditLog.deleteMany({ where: { contaId } });

  if (profile) {
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
  }

  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('createAsaasAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(async () => {
    // sem-op
  });

  it('deve criar subconta e ser idempotente em retries (sem duplicar registros)', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CNPJ,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    try {
      await financeProfileService.setOnboardingData(conta.id, {
        personType: 'PJ',
        ownerName: 'Joao da Silva',
        companyName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CNPJ,
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001000',
        companyType: 'LIMITED',
      });

      const first = await createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } });
      const second = await createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } });

      expect(first.asaasAccountId).toEqual(subaccountId);
      expect(second.asaasAccountId).toEqual(subaccountId);
      expect(first.status).toBe('CREATED');

      const { createSubaccount } = await import('@alusa/asaas');
      const call = vi.mocked(createSubaccount).mock.calls[0]?.[0];
      expect(call?.data?.email).toBe(`owner+${unique}@teste.com`);
      expect(call?.data).not.toHaveProperty('loginEmail');

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });
      expect(profile).not.toBeNull();

      const asaasAccountCount = await prisma.asaasAccount.count({
        where: { financeProfileId: profile!.id },
      });
      expect(asaasAccountCount).toBe(1);

      const credential = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile!.id } });
      expect(credential).not.toBeNull();

      const decrypted = credentialVault.decrypt(credential!.apiKeyEncrypted);
      expect(decrypted).toEqual('$aact_sub_123');

      const auditCount = await prisma.auditLog.count({ where: { contaId: conta.id } });
      expect(auditCount).toBeGreaterThan(0);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve exigir recuperação manual quando subconta já existe sem chave salva', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CNPJ,
      },
    });

    try {
      const profile = await prisma.financeProfile.create({
        data: {
          contaId: conta.id,
          asaasOwnerName: 'Joao da Silva',
          mobilePhone: '11999999999',
          incomeValue: 1000,
          address: 'Rua Teste',
          addressNumber: '123',
          province: 'Centro',
          postalCode: '01001000',
          companyType: 'LIMITED',
        },
      });

      await prisma.asaasAccount.create({
        data: {
          financeProfileId: profile.id,
          asaasAccountId: subaccountId,
          status: 'CREATED',
          statusUpdatedAt: new Date(),
          apiKeyStatus: 'MISSING',
        },
      });

      const result = await createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: unique } });
      expect(result.asaasAccountId).toEqual(subaccountId);
      expect(result.requiresManualApiKeyRecovery).toBe(true);
      expect(result.status).toBe('PROVISIONING_FAILED');

      const { createSubaccountAccessToken, createSubaccount } = await import('@alusa/asaas');
      expect(vi.mocked(createSubaccountAccessToken)).not.toHaveBeenCalled();
      expect(vi.mocked(createSubaccount)).not.toHaveBeenCalled();

      const stored = await prisma.asaasAccount.findUnique({ where: { financeProfileId: profile.id } });
      expect(stored?.apiKeyEncrypted).toBeNull();
      expect(stored?.apiKeyStatus).toBe('MISSING');
      expect(stored?.provisionLastError).toContain('RECOVERY_REQUIRED');

      const credential = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile.id } });
      expect(credential).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('PJ: deve exigir companyType e não exigir birthDate', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CNPJ,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    try {
      await financeProfileService.setOnboardingData(conta.id, {
        personType: 'PJ',
        ownerName: 'Joao da Silva',
        companyName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CNPJ,
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001000',
        companyType: 'LIMITED',
      });

      await createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } });

      const { createSubaccount } = await import('@alusa/asaas');
      const call = vi.mocked(createSubaccount).mock.calls[0]?.[0];
      expect(call?.data).toMatchObject({ companyType: 'LIMITED' });
      expect(call?.data?.name).toBe('Conta Financeira Teste');
      expect(call?.data).not.toHaveProperty('birthDate');
      expect(call?.data).not.toHaveProperty('loginEmail');
      expect(call?.data).not.toHaveProperty('site');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('PJ: deve falhar quando companyType está ausente', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CNPJ,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    try {
      await prisma.financeProfile.create({
        data: {
          contaId: conta.id,
          asaasName: 'Conta Financeira Teste',
          mobilePhone: '11999999999',
          incomeValue: 1000,
          address: 'Rua Teste',
          addressNumber: '123',
          province: 'Centro',
          postalCode: '01001000',
          // companyType ausente propositalmente
        },
      });

      await expect(createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } })).rejects.toBeInstanceOf(
        MissingCompanyTypeError,
      );
    } finally {
      await cleanup(conta.id);
    }
  });

  it('PF: deve falhar quando birthDate está ausente', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CPF,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    try {
      await prisma.financeProfile.create({
        data: {
          contaId: conta.id,
          asaasName: 'Conta Financeira PF Teste',
          mobilePhone: '11999999999',
          incomeValue: 1000,
          address: 'Rua Teste',
          addressNumber: '123',
          province: 'Centro',
          postalCode: '01001000',
        },
      });

      await expect(createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } })).rejects.toBeInstanceOf(
        MissingBirthDateError,
      );
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve falhar com ASAAS_NOT_CONFIGURED quando ASAAS_API_KEY está ausente', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CNPJ,
      },
    });

    const user = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: 'Owner',
        email: `owner+${unique}@teste.com`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        senhaHash: 'hash',
        role: 'ADMIN',
      },
    });

    const previousApiKey = process.env.ASAAS_API_KEY;
    delete process.env.ASAAS_API_KEY;

    try {
      await financeProfileService.setOnboardingData(conta.id, {
        personType: 'PJ',
        ownerName: 'Joao da Silva',
        companyName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CNPJ,
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001000',
        companyType: 'LIMITED',
      });

      await expect(createAsaasAccount({ contaId: conta.id, actor: { type: 'USER', id: user.id } })).rejects.toBeInstanceOf(
        MissingAsaasApiKeyError,
      );
    } finally {
      if (previousApiKey !== undefined) {
        process.env.ASAAS_API_KEY = previousApiKey;
      } else {
        delete process.env.ASAAS_API_KEY;
      }

      await cleanup(conta.id);
    }
  });
});
