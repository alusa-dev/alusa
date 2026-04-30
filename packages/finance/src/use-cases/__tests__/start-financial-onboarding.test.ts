import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { financeProfileService } from '../../foundation/finance-profile.service';
import { startFinancialOnboarding } from '../start-financial-onboarding';

const VALID_CPF = '11144477735';

const subaccountId = `asaas-account-${randomUUID()}`;

vi.mock('@alusa/asaas', async () => {
  return {
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
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? '$aact_master_test';
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

describe('startFinancialOnboarding', () => {
  afterEach(async () => {
    // cleanup por teste
  });

  it('deve criar placeholder local e ser idempotente mesmo sem dados suficientes', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CPF,
      },
    });

    try {
      const first = await startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } });
      const second = await startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } });

      expect(first.financeStatus).toBe('FINANCE_ONBOARDING_STARTED');
      expect(first.hasAsaasAccountRecord).toBe(true);
      expect(first.hasSubaccount).toBe(false);
      expect(first.status).toBe('IN_PROGRESS');

      expect(second.financeStatus).toBe('FINANCE_ONBOARDING_STARTED');

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
      expect(profile).not.toBeNull();

      const asaasAccountCount = await prisma.asaasAccount.count({ where: { financeProfileId: profile!.id } });
      expect(asaasAccountCount).toBe(1);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve ser idempotente mesmo com chamadas concorrentes', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CPF,
      },
    });

    try {
      await Promise.all([
        startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } }),
        startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } }),
        startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } }),
      ]);

      const profileCount = await prisma.financeProfile.count({ where: { contaId: conta.id } });
      expect(profileCount).toBe(1);

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
      expect(profile).not.toBeNull();

      const asaasAccountCount = await prisma.asaasAccount.count({ where: { financeProfileId: profile!.id } });
      expect(asaasAccountCount).toBe(1);

      const contaStatus = await prisma.conta.findUnique({ where: { id: conta.id }, select: { financeStatus: true } });
      expect(contaStatus?.financeStatus).toBe('FINANCE_ONBOARDING_STARTED');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('não deve provisionar subconta no /start, mesmo se já houver dados obrigatórios', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: VALID_CPF,
        enderecoLogradouro: 'Rua Teste',
        enderecoNumero: '123',
        enderecoBairro: 'Centro',
        enderecoCep: '01001000',
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
        personType: 'PF',
        ownerName: 'Conta Financeira Teste',
        cpfCnpj: VALID_CPF,
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001000',
      });

      const result = await startFinancialOnboarding({ contaId: conta.id, actor: { type: 'USER', id: user.id } });

      expect(result.financeStatus).toBe('FINANCE_ONBOARDING_STARTED');
      expect(result.hasSubaccount).toBe(false);
      expect(result.status).toBe('IN_PROGRESS');

      const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id }, select: { id: true } });
      expect(profile).not.toBeNull();

      const account = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile!.id },
        select: { asaasAccountId: true },
      });
      expect(account?.asaasAccountId).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('não deve rebaixar financeStatus se já estiver em estado mais avançado', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste (status avançado)',
        cpfCnpj: VALID_CPF,
        financeStatus: 'FINANCE_PROFILE_COMPLETED',
      },
    });

    try {
      const result = await startFinancialOnboarding({ contaId: conta.id, actor: { type: 'SYSTEM' } });

      expect(result.financeStatus).toBe('FINANCE_PROFILE_COMPLETED');

      const refreshed = await prisma.conta.findUnique({ where: { id: conta.id }, select: { financeStatus: true } });
      expect(refreshed?.financeStatus).toBe('FINANCE_PROFILE_COMPLETED');
    } finally {
      await cleanup(conta.id);
    }
  });
});
