import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { featureFlagsService } from '../feature-flags.service';

async function cleanup(contaId: string) {
  await prisma.auditLog.deleteMany({ where: { contaId } });
  await prisma.tenantFeatureFlags.deleteMany({ where: { contaId } });
  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('featureFlagsService', () => {
  afterEach(async () => {
    // sem-op: cleanup por teste
    delete process.env.ASAAS_AUTO_PROVISION_TRANSFER_FEATURES;
    delete process.env.ASAAS_BASE_URL;
  });

  it('isEnabled deve retornar false quando não existe registro', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Flags',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      const enabled = await featureFlagsService.isEnabled(conta.id, 'enableSubscriptions');
      expect(enabled).toBe(false);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('getOrCreate deve criar e permitir habilitar flag', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Flags 2',
        cpfCnpj: `000000000002${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      await featureFlagsService.getOrCreate(conta.id);
      await prisma.tenantFeatureFlags.update({
        where: { contaId: conta.id },
        data: { enableSubscriptions: true },
      });

      const enabled = await featureFlagsService.isEnabled(conta.id, 'enableSubscriptions');
      expect(enabled).toBe(true);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('auto-provisiona transferências em sandbox para conta aprovada', async () => {
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Flags 3',
        cpfCnpj: `000000000003${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      const profile = await prisma.financeProfile.create({
        data: {
          contaId: conta.id,
          status: 'APPROVED',
          isOnboardingCompleted: true,
        },
      });

      await prisma.asaasAccount.create({
        data: {
          financeProfileId: profile.id,
          status: 'APPROVED',
        },
      });

      const result = await featureFlagsService.ensureTransferFeaturesForApprovedAccount({
        contaId: conta.id,
        reason: 'test',
      });

      expect(result.changed).toBe(true);
      expect(result.enabledFlags).toEqual([
        'enableManualWithdraw',
        'enablePixTransfer',
        'enableBankTransfer',
      ]);

      const flags = await prisma.tenantFeatureFlags.findUnique({
        where: { contaId: conta.id },
        select: {
          enableManualWithdraw: true,
          enablePixTransfer: true,
          enableBankTransfer: true,
        },
      });

      expect(flags).toEqual({
        enableManualWithdraw: true,
        enablePixTransfer: true,
        enableBankTransfer: true,
      });
    } finally {
      await cleanup(conta.id);
    }
  });

  it('não auto-provisiona transferências em produção por padrão', async () => {
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Flags 4',
        cpfCnpj: `000000000004${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      const profile = await prisma.financeProfile.create({
        data: {
          contaId: conta.id,
          status: 'APPROVED',
          isOnboardingCompleted: true,
        },
      });

      await prisma.asaasAccount.create({
        data: {
          financeProfileId: profile.id,
          status: 'APPROVED',
        },
      });

      const result = await featureFlagsService.ensureTransferFeaturesForApprovedAccount({
        contaId: conta.id,
        reason: 'test-prod',
      });

      expect(result.changed).toBe(false);
      expect(result.skippedReason).toBe('POLICY_DISABLED');

      const flags = await prisma.tenantFeatureFlags.findUnique({ where: { contaId: conta.id } });
      expect(flags).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });
});
