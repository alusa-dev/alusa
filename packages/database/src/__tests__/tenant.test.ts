import { afterEach, describe, expect, it, vi } from 'vitest';

const { baseClient, rlsClient, rlsClientConstructor } = vi.hoisted(() => {
  const makeClient = () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn();
    return {
      executeRaw,
      queryRaw,
      client: {
        $transaction: vi.fn(async (callback: (tx: { $executeRaw: typeof executeRaw }) => Promise<unknown>, options?: unknown) => {
          const value = await callback({ $executeRaw: executeRaw, $queryRaw: queryRaw } as never);
          return value;
        }),
      },
    };
  };
  const base = makeClient();
  const rls = makeClient();
  const constructor = vi.fn(() => rls.client);
  return {
    baseClient: base,
    rlsClient: rls,
    rlsClientConstructor: constructor,
  };
});

vi.mock('../client.js', () => ({ prisma: baseClient.client }));
vi.mock('@prisma/client', () => ({ PrismaClient: rlsClientConstructor }));

describe('database tenant runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejeita contaId vazio antes de abrir transação', async () => {
    const { runWithTenant } = await import('../tenant.js');
    await expect(runWithTenant('  ', async () => null)).rejects.toThrow(
      'contaId is required for tenant-scoped database access',
    );
    expect(baseClient.client.$transaction).not.toHaveBeenCalled();
  });

  it('define app.current_conta_id na transação do cliente padrão quando RLS está desligado', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'false');
    const { runWithTenant, isRlsRuntimeEnabled } = await import('../tenant.js');

    expect(isRlsRuntimeEnabled()).toBe(false);
    await expect(runWithTenant(' conta-abc ', async () => 'ok')).resolves.toBe('ok');

    expect(baseClient.client.$transaction).toHaveBeenCalledTimes(1);
    expect(baseClient.executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('set_config')]),
      'conta-abc',
    );
  });

  it('fail closed sem DATABASE_RLS_URL quando RLS runtime está habilitado', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('DATABASE_RLS_URL', '');
    const { runWithTenant } = await import('../tenant.js');

    await expect(runWithTenant('conta-abc', async () => null)).rejects.toThrow(
      'DATABASE_RLS_URL is required when RLS_RUNTIME_ENABLED=true',
    );
  });

  it('seleciona o client RLS dedicado e passa opções da transação quando runtime está habilitado', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('DATABASE_RLS_URL', 'postgresql://rls-role/db');
    const { runWithTenant } = await import('../tenant.js');
    const options = { isolationLevel: 'Serializable' as const };

    await expect(runWithTenant('conta-rls', async () => 'rls-ok', options)).resolves.toBe('rls-ok');

    expect(rlsClientConstructor).toHaveBeenCalledWith(expect.objectContaining({
      datasources: { db: { url: 'postgresql://rls-role/db' } },
    }));
    expect(rlsClient.client.$transaction).toHaveBeenCalledWith(expect.any(Function), options);
    expect(rlsClient.executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('set_config')]),
      'conta-rls',
    );
  });

  it('usa somente a função compartilhada para health tenant-scoped e normaliza contaId', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'false');
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ current_user: 'app_user', current_conta_id: 'conta-health', rls_runtime_enabled: false }])
      .mockResolvedValueOnce([{ aluno_count: 3n }]);
    baseClient.client.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $executeRaw: baseClient.executeRaw, $queryRaw: queryRaw }) as never,
    );
    const { getTenantRuntimeHealth } = await import('../tenant.js');

    await expect(getTenantRuntimeHealth(' conta-health ')).resolves.toEqual({
      currentUser: 'app_user', currentContaId: 'conta-health', rlsRuntimeEnabled: false, alunoCount: 3,
    });
    expect(baseClient.executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('set_config')]),
      'conta-health',
    );
  });
});
