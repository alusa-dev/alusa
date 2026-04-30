import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { encryptSecret, prisma } from '@alusa/database';

import { excluirContaAlusaEAsaas } from '../admin/delete-asaas-account';

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
    createSubaccountAccessToken: vi.fn(async () => ({ id: 'at_1', apiKey: '$aact_sub_temp' })),
    deleteSubaccountAccessToken: vi.fn(async () => ({ deleted: true })),
    deleteMyAccount: vi.fn(async () => ({ deleted: true })),
    // Após DELETE /myAccount, esperamos que a chave da subconta deixe de funcionar.
    // Por padrão nos testes, simular 401 para a confirmação pós-delete.
    getMyAccountStatus: vi.fn(async () => {
      throw new AsaasHttpError('unauthorized', 401, { errors: [{ code: 'invalid_access_token' }] });
    }),
    getBalance: vi.fn(async () => ({ object: 'balance', balance: 0 })),
    getWallets: vi.fn(async () => ({ data: [] })),
  };
});

vi.mock('@alusa/database', async () => {
  const actual = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
  return {
    ...actual,
    loadAsaasCredentials: vi.fn(async () => null),
  };
});

const { AsaasHttpError, createSubaccountAccessToken, deleteMyAccount, getMyAccountStatus } = await import('@alusa/asaas');
const { loadAsaasCredentials } = await import('@alusa/database');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? '$aact_master_test';

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  if (profile) {
    const asaasAccounts = await prisma.asaasAccount.findMany({
      where: { financeProfileId: profile.id },
      select: { id: true },
    });
    const asaasAccountIds = asaasAccounts.map((a) => a.id);

    if (asaasAccountIds.length) {
      await prisma.asaasAccountStatusHistory.deleteMany({
        where: { asaasAccountId: { in: asaasAccountIds } },
      });
    }
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.asaasCredential.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.financeProfile.deleteMany({ where: { contaId } });
  }

  await prisma.logIntegracao.deleteMany({ where: { contaId } });
  await prisma.auditLog.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('excluirContaAlusaEAsaas', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia quando confirmText != DELETAR', async () => {
    const result = await excluirContaAlusaEAsaas({
      contaId: 'c1',
      confirmText: 'deletar',
      removeReason: 'teste',
      actor: { type: 'ADMIN', id: 'u1' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe('deletion_failed_needs_admin');
      expect(result.errorCode).toBe('CONFIRM_TEXT_INVALID');
      expect(result.asaasDeleted).toBe(false);
      expect(result.localDeleted).toBe(false);
    }
  });

  it('não exclui localmente se a exclusão no Asaas falhar', async () => {
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
        status: 'APPROVED',
      },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);
    vi.mocked(deleteMyAccount).mockRejectedValueOnce(
      new (await import('@alusa/asaas')).AsaasHttpError('fail', 400, {
        errors: [{ code: 'invalid', description: 'not allowed' }],
      }),
    );

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'pedido do cliente',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.localDeleted).toBe(false);
      }

      const updatedConta = await prisma.conta.findUnique({ where: { id: conta.id }, select: { deletedAt: true } });
      expect(updatedConta?.deletedAt).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('exclui no Asaas e faz hard delete local (usando chave temporária quando não há credencial)', async () => {
    const unique = randomUUID();

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });

    const asaasAccount = await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile!.id,
        asaasAccountId: `acc_${unique}`,
        status: 'APPROVED',
      },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);

    const contaId = conta.id;
    const asaasAccountId = asaasAccount.id;

    const result = await excluirContaAlusaEAsaas({
      contaId: conta.id,
      confirmText: 'DELETAR',
      removeReason: 'encerramento',
      actor: { type: 'ADMIN', id: 'u1' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe('deleted');
    }
    expect(vi.mocked(createSubaccountAccessToken)).toHaveBeenCalled();
    expect(vi.mocked(deleteMyAccount)).toHaveBeenCalled();

    // Soft delete: Conta deve existir com status INATIVO e timestamp deletedAt
    const deletedConta = await prisma.conta.findUnique({
      where: { id: contaId },
    });
    expect(deletedConta).not.toBeNull();
    expect(deletedConta!.status).toBe('INATIVO');
    expect(deletedConta!.deletedAt).toBeInstanceOf(Date);

    // AsaasAccount deve persistir com asaasAccountId null e deletedAsaasAccountId preenchido
    const deletedAsaas = await prisma.asaasAccount.findUnique({
      where: { id: asaasAccountId },
    });
    expect(deletedAsaas).not.toBeNull();
    expect(deletedAsaas!.asaasAccountId).toBeNull();
    expect(deletedAsaas!.deletedAsaasAccountId).toBe(`acc_${unique}`);

    // Cleanup manual (já que não há mais hard delete)
    await prisma.conta.delete({ where: { id: contaId } }).catch(() => null);
  });

  it('repara vínculo via FinanceProfile.asaasAccountId (legado) e prossegue com a exclusão', async () => {
    const unique = randomUUID();

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste - reparo vínculo',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-link-repair-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    const profile = await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
        asaasAccountId: `acc_${unique}`,
      },
      select: { id: true },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'encerramento',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(true);
      expect(vi.mocked(createSubaccountAccessToken)).toHaveBeenCalled();
      expect(vi.mocked(deleteMyAccount)).toHaveBeenCalled();

      const repaired = await prisma.auditLog.findFirst({
        where: { contaId: conta.id, action: 'finance.admin.asaas_link_repaired' },
        select: { id: true },
      });
      expect(repaired).not.toBeNull();

      const updatedAsaas = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile.id },
        select: { deletedAsaasAccountId: true, asaasAccountId: true, deletionState: true },
      });

      expect(updatedAsaas?.deletionState).toBe('DELETED');
      expect(updatedAsaas?.asaasAccountId).toBeNull();
      expect(updatedAsaas?.deletedAsaasAccountId).toMatch(/^acc_/);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('quando FinanceProfile.asaasAccountId existe mas é inválido: não repara e bloqueia como vínculo não confiável', async () => {
    const unique = randomUUID();

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste - vínculo inválido',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
        asaasAccountId: `INVALID_${unique}`,
      },
      select: { id: true },
    });

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'encerramento',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ASAAS_ACCOUNT_NOT_LINKED');
        expect(result.debugSafe?.linkFailure).toMatchObject({ code: 'INVALID_LOCAL_ASAAS_ACCOUNT_ID' });
      }

      const linked = await prisma.asaasAccount.findFirst({ where: { financeProfile: { contaId: conta.id } } });
      expect(linked).toBeNull();

      const repairedAudit = await prisma.auditLog.findFirst({
        where: { contaId: conta.id, action: 'finance.admin.asaas_link_repaired' },
        select: { id: true },
      });
      expect(repairedAudit).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('quando nenhum ID local existe: bloqueia com causa ausente (sem persistir)', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste - vínculo ausente',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'encerramento',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe('ASAAS_ACCOUNT_NOT_LINKED');
        expect(result.debugSafe?.linkFailure).toMatchObject({ code: 'MISSING_LOCAL_ASAAS_ACCOUNT_ID' });
      }

      const linked = await prisma.asaasAccount.findFirst({ where: { financeProfile: { contaId: conta.id } } });
      expect(linked).toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('quando não há ID no DB mas existe apiKey local: usa /myAccount/status para inferir e reparar vínculo', async () => {
    const unique = randomUUID();

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste - probe apiKey',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-probe-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    const profile = await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
        asaasAccountId: null,
      },
      select: { id: true },
    });

    await prisma.asaasCredential.create({
      data: {
        financeProfileId: profile.id,
        apiKeyEncrypted: encryptSecret('$aact_sub_local_probe'),
      },
      select: { id: true },
    });

    // Fazer o mock usar a implementação real (lê/decripta do DB)
    const actualDb = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockImplementation(actualDb.loadAsaasCredentials);

    vi.mocked(getMyAccountStatus)
      .mockResolvedValueOnce({ id: 'acc_1234567890abcdef' })
      .mockRejectedValueOnce(new AsaasHttpError('unauthorized', 401, { errors: [{ code: 'invalid_access_token' }] }));

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'encerramento',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe('deleted');
      }

      const repairedAudit = await prisma.auditLog.findFirst({
        where: { contaId: conta.id, action: 'finance.admin.asaas_link_repaired' },
        select: { metadata: true },
      });

      expect(repairedAudit).not.toBeNull();
      expect(repairedAudit?.metadata).toMatchObject({
        asaasAccountId: 'acc_1234567890abcdef',
        source: 'SUBACCOUNT_API_KEY',
      });

      const asaasAccount = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile.id },
        select: { id: true, deletedAsaasAccountId: true, deletionState: true },
      });

      expect(asaasAccount).not.toBeNull();
      expect(asaasAccount?.deletionState).toBe('DELETED');
      expect(asaasAccount?.deletedAsaasAccountId).toBe('acc_1234567890abcdef');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('429: faz retry e só comita local após sucesso no Asaas', async () => {
    const unique = randomUUID();
    const cnpjSuffix = String(Date.now() % 100000000).padStart(8, '0');

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste 429',
        cpfCnpj: `000000${cnpjSuffix}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-429-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });

    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile!.id,
        asaasAccountId: `acc_${unique}`,
        status: 'APPROVED',
      },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);

    const AsaasErr = (await import('@alusa/asaas')).AsaasHttpError;
    vi.mocked(deleteMyAccount)
      .mockRejectedValueOnce(new AsaasErr('rate limit', 429, { errors: [{ code: 'rate', description: 'Too many requests' }] }))
      .mockRejectedValueOnce(new AsaasErr('rate limit', 429, { errors: [{ code: 'rate', description: 'Too many requests' }] }))
      .mockResolvedValueOnce({ deleted: true } as any);

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'teste rate limit',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(vi.mocked(deleteMyAccount)).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);

      const updatedConta = await prisma.conta.findUnique({ where: { id: conta.id }, select: { deletedAt: true } });
      expect(updatedConta?.deletedAt).toBeInstanceOf(Date);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('404: trata como sucesso idempotente somente quando estado local confirma deleção externa', async () => {
    const unique = randomUUID();
    const now = new Date();
    const cnpjSuffix = String(Date.now() % 100000000).padStart(8, '0');

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste 404',
        cpfCnpj: `000000${cnpjSuffix}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-404-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });

    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile!.id,
        asaasAccountId: `acc_${unique}`,
        status: 'APPROVED',
        deletionState: 'DELETED_EXTERNALLY',
        deletedExternallyAt: now,
      },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);

    const AsaasErr = (await import('@alusa/asaas')).AsaasHttpError;
    vi.mocked(deleteMyAccount).mockRejectedValueOnce(
      new AsaasErr('not found', 404, { errors: [{ code: 'not_found', description: 'Not found' }] }),
    );

    try {
      const result = await excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'idempotente',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      expect(result.success).toBe(true);

      const updatedConta = await prisma.conta.findUnique({ where: { id: conta.id }, select: { deletedAt: true } });
      expect(updatedConta?.deletedAt).toBeInstanceOf(Date);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('concorrência: duas requisições simultâneas não geram estado inválido', async () => {
    const unique = randomUUID();
    const cnpjSuffix = String(Date.now() % 100000000).padStart(8, '0');

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Concorrência',
        cpfCnpj: `000000${cnpjSuffix}`,
      },
    });

    await prisma.usuario.create({
      data: {
        id: 'u1',
        contaId: conta.id,
        nome: 'Admin Teste',
        email: `admin-concurrency-${unique}@example.com`,
        senhaHash: 'hash',
        role: 'ADMIN',
      },
      select: { id: true },
    });

    await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const profile = await prisma.financeProfile.findUnique({ where: { contaId: conta.id } });

    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile!.id,
        asaasAccountId: `acc_${unique}`,
        status: 'APPROVED',
      },
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValue(null);

    let resolveDelete: ((value: any) => void) | null = null;
    vi.mocked(deleteMyAccount).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }) as any,
    );

    try {
      const p1 = excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'concorrência',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      // Garantir que a primeira chamada entrou no fluxo antes da segunda tentar
      await new Promise((r) => setTimeout(r, 25));

      const p2 = excluirContaAlusaEAsaas({
        contaId: conta.id,
        confirmText: 'DELETAR',
        removeReason: 'concorrência',
        actor: { type: 'ADMIN', id: 'u1' },
      });

      const second = await p2;
      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.status).toBe('deleting');
        expect(second.errorCode).toBe('DELETE_ALREADY_IN_PROGRESS');
      }

      resolveDelete?.({ deleted: true });
      const first = await p1;
      expect(first.success).toBe(true);

      // deleteMyAccount só deve ser disparado uma vez
      expect(vi.mocked(deleteMyAccount)).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(conta.id);
    }
  });
});
