import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { reconnectAsaasAccount } from '../admin/reconnect-asaas-account';

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
    getMyAccount: vi.fn(async () => ({ id: 'my_account' })),
  };
});

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  if (profile) {
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.financeProfile.deleteMany({ where: { contaId } });
  }

  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('reconnectAsaasAccount', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reconecta quando apiKey é válida', async () => {
    const contaId = `conta-${randomUUID()}`;
    const conta = await prisma.conta.create({ data: { id: contaId, nome: 'Conta Teste' } });
    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const account = await prisma.asaasAccount.create({ data: { financeProfileId: profile.id } });

    const result = await reconnectAsaasAccount({
      contaId,
      apiKey: 'sandbox_valid_key',
      actor: { type: 'ADMIN' },
    });

    expect(result.success).toBe(true);

    const refreshed = await prisma.asaasAccount.findUnique({ where: { id: account.id } });
    expect(refreshed?.apiKeyStatus).toBe('CONNECTED');
    expect(refreshed?.apiKeyEncrypted).toBeTruthy();

    const creds = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile.id } });
    expect(creds?.apiKeyEncrypted).toBeTruthy();

    await cleanup(contaId);
  });

  it('retorna erro quando apiKey é inválida', async () => {
    const { getMyAccount } = await import('@alusa/asaas');
    vi.mocked(getMyAccount).mockRejectedValueOnce(new (await import('@alusa/asaas')).AsaasHttpError('Unauthorized', 401));

    const contaId = `conta-${randomUUID()}`;
    const conta = await prisma.conta.create({ data: { id: contaId, nome: 'Conta Teste' } });
    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });
    await prisma.asaasAccount.create({ data: { financeProfileId: profile.id } });

    const result = await reconnectAsaasAccount({
      contaId,
      apiKey: 'sandbox_invalid_key',
      actor: { type: 'ADMIN' },
    });

    expect(result.success).toBe(false);

    const creds = await prisma.asaasCredential.findUnique({ where: { financeProfileId: profile.id } });
    expect(creds).toBeNull();

    await cleanup(contaId);
  });
});
