import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { credentialVault } from '../../foundation/credential-vault';
import { submitKycData } from '../submit-kyc-data';

const VALID_CPF = '11144477735';

const subaccountId = `asaas-account-${randomUUID()}`;

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');

  return {
    ...actual,
    createSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    updateSubaccount: vi.fn(async () => ({
      object: 'account',
      id: subaccountId,
      name: 'Conta Teste',
      email: 'owner@teste.com',
      cpfCnpj: VALID_CPF,
      apiKey: '$aact_sub_123',
      walletId: 'wallet-1',
    })),
    getMyAccount: vi.fn(async () => ({ id: subaccountId })),
    getMyAccountCommercialInfo: vi.fn(async () => ({
      email: 'owner@teste.com',
      mobilePhone: '11999999999',
      personType: 'FISICA',
      cpfCnpj: VALID_CPF,
      name: 'Conta Financeira Teste',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001000',
    })),
    updateMyAccountCommercialInfo: vi.fn(async () => ({
      status: 'APPROVED',
    })),
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY || '$aact_master_test';
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

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

describe('submitKycData', () => {
  afterEach(async () => {
    // sem-op: cleanup por teste
  });

  it('não deve criar subconta se o profile ainda não estiver completo (ex: sem email/identidade do tenant)', async () => {
    const { createSubaccount } = await import('@alusa/asaas');

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste KYC (sem identidade)',
        cpfCnpj: VALID_CPF,
      },
    });

    try {
      const result = await submitKycData({
        contaId: conta.id,
        payload: {
          personType: 'PF',
          ownerName: 'Conta Financeira Teste',
          cpfCnpj: VALID_CPF,
          birthDate: '1990-01-01',
          mobilePhone: '11999999999',
          incomeValue: 1000,
          address: 'Rua Teste',
          addressNumber: '123',
          province: 'Centro',
          postalCode: '01001-000',
          complement: 'Apto 1',
        },
        actor: { type: 'SYSTEM' },
      });

      expect(vi.mocked(createSubaccount)).not.toHaveBeenCalled();

      expect(result.hasAsaasAccountRecord).toBe(true);
      expect(result.hasSubaccount).toBe(false);
      expect(result.status).toBe('NOT_STARTED');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve criar subconta somente quando profile estiver completo e ser idempotente (cria 1x)', async () => {
    const { createSubaccount, updateSubaccount } = await import('@alusa/asaas');
    const unique = randomUUID();

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste KYC',
        cpfCnpj: VALID_CPF,
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

    const payload = {
      personType: 'PF' as const,
      ownerName: 'Conta Financeira Teste',
      cpfCnpj: VALID_CPF,
      birthDate: '1990-01-01',
      mobilePhone: '11999999999',
      incomeValue: 1000,
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01001-000',
      complement: 'Apto 1',
    };

    try {
      const first = await submitKycData({
        contaId: conta.id,
        payload,
        actor: { type: 'USER', id: user.id },
      });

      const second = await submitKycData({
        contaId: conta.id,
        payload,
        actor: { type: 'USER', id: user.id },
      });

      expect(vi.mocked(createSubaccount)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createSubaccount).mock.calls[0]?.[0]?.apiKey).toBe(process.env.ASAAS_API_KEY);
      expect(vi.mocked(createSubaccount).mock.calls[0]?.[0]?.data).not.toHaveProperty('loginEmail');
      expect(vi.mocked(createSubaccount).mock.calls[0]?.[0]?.data).not.toHaveProperty('site');

      expect(first.hasSubaccount).toBe(true);
      expect(first.status).toBe('UNDER_REVIEW');
      expect(second.hasSubaccount).toBe(true);

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
      expect(profile).not.toBeNull();

      const account = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile!.id },
        select: { asaasAccountId: true },
      });
      expect(account?.asaasAccountId).toBe(subaccountId);

      const credential = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile!.id } });
      expect(credential).not.toBeNull();
      expect(credentialVault.decrypt(credential!.apiKeyEncrypted)).toBe('$aact_sub_123');

      // segundo submit pode atualizar dados no Asaas, mas sempre via master
      if (vi.mocked(updateSubaccount).mock.calls.length > 0) {
        expect(vi.mocked(updateSubaccount).mock.calls[0]?.[0]?.apiKey).toBe(process.env.ASAAS_API_KEY);
        expect(vi.mocked(updateSubaccount).mock.calls[0]?.[0]?.data).not.toHaveProperty('email');
        expect(vi.mocked(updateSubaccount).mock.calls[0]?.[0]?.data).not.toHaveProperty('loginEmail');
        expect(vi.mocked(updateSubaccount).mock.calls[0]?.[0]?.data).not.toHaveProperty('site');
      }

      const auditCount = await prisma.auditLog.count({ where: { contaId: conta.id } });
      expect(auditCount).toBeGreaterThan(0);
    } finally {
      await cleanup(conta.id);
    }
  });
});
