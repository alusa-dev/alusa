import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { financeProfileService } from '../finance-profile.service';

const VALID_CPF = '11144477735';

async function cleanup(contaId: string) {
  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('financeProfileService', () => {
  it('setOnboardingData deve normalizar postalCode (somente dígitos, max 8)', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste FinanceProfile',
        cpfCnpj: VALID_CPF,
      },
    });

    try {
      const updated = await financeProfileService.setOnboardingData(conta.id, {
        personType: 'PF',
        ownerName: 'João da Silva',
        cpfCnpj: VALID_CPF,
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua X',
        addressNumber: '123',
        province: 'SP',
        postalCode: '12.345-6789',
        complement: 'Apto 1',
      });

      expect(updated.postalCode).toBe('12345678');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('setOnboardingData deve rejeitar payload inválido', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste FinanceProfile 2',
        cpfCnpj: VALID_CPF,
      },
    });

    try {
      await expect(
        // @ts-expect-error - validação runtime
        financeProfileService.setOnboardingData(conta.id, { postalCode: '123' }),
      ).rejects.toBeDefined();
    } finally {
      await cleanup(conta.id);
    }
  });
});
