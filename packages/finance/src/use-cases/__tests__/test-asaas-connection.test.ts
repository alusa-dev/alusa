import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import * as database from '@alusa/database';

import { testarConexaoAsaas } from '../admin/test-asaas-connection';

vi.mock('@alusa/asaas', async () => {
  return {
    AsaasHttpError: class AsaasHttpError extends Error {
      constructor(
        message: string,
        public status: number,
        public response?: unknown,
      ) {
        super(message);
        this.name = 'AsaasHttpError';
      }
    },
    getMyAccountStatus: vi.fn(async () => ({ object: 'myAccountStatus' })),
    getSubaccount: vi.fn(async ({ accountId }: { accountId: string }) => ({ id: accountId })),
    listWebhooks: vi.fn(async () => ({
      data: [
        {
          id: 'wh_1',
          url: `${process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://x.ngrok-free.dev'}/api/webhooks/asaas`,
          enabled: true,
        },
      ],
    })),
  };
});

const { prisma } = database;
const { getMyAccountStatus } = await import('@alusa/asaas');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? '$aact_master_test';
process.env.FEATURE_ASAAS = 'true';
process.env.NEXT_PUBLIC_APP_URL = 'https://x.ngrok-free.dev';
process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL = 'https://x.ngrok-free.dev';
process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'test-webhook-secret';

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  if (profile) {
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.financeProfile.deleteMany({ where: { contaId } });
  }

  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('testarConexaoAsaas', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna sucesso quando env + auth + subconta + webhook estão OK', async () => {
    process.env.FEATURE_ASAAS = 'true';
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    process.env.ASAAS_API_KEY = '$aact_master_test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://x.ngrok-free.dev';
    process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL = 'https://x.ngrok-free.dev';
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'test-webhook-secret';

    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });
    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile!.id,
        asaasAccountId: `acc_${unique}`,
        status: 'CREATED',
      },
    });

    try {
      vi.spyOn(database, 'loadAsaasCredentials').mockResolvedValue({ apiKey: '$aact_sub_test' } as never);

      const result = await testarConexaoAsaas({ contaId: conta.id });

      expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
      if (result.success) {
        expect(result.checks.env).toBe('ok');
        expect(result.checks.auth).toBe('ok');
        expect(result.checks.account).toBe('ok');
        expect(result.checks.webhook).toBe('ok');
      }

      const updated = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile!.id },
        select: { status: true, externalReference: true, statusUpdatedAt: true },
      });
      expect(updated?.status).toBe('APPROVED');
      expect(updated?.externalReference).toBe(`financeProfile:${profile!.id}`);
      expect(updated?.statusUpdatedAt).toBeInstanceOf(Date);

      expect(vi.mocked(getMyAccountStatus)).toHaveBeenCalled();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('falha em env quando ASAAS_API_KEY está ausente', async () => {
    const previous = process.env.ASAAS_API_KEY;
    delete process.env.ASAAS_API_KEY;

    try {
      const result = await testarConexaoAsaas({ contaId: 'conta-x' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ASAAS_ENV_MISSING');
        expect(result.details.step).toBe('env');
      }
    } finally {
      if (previous !== undefined) process.env.ASAAS_API_KEY = previous;
      else delete process.env.ASAAS_API_KEY;
    }
  });
});
