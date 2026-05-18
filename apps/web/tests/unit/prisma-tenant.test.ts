import { afterEach, describe, expect, it, vi } from 'vitest';

const executeRaw = vi.fn().mockResolvedValue(1);
const transaction = vi.fn(async (callback: (tx: { $executeRaw: typeof executeRaw }) => Promise<unknown>) =>
  callback({ $executeRaw: executeRaw }),
);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transaction,
  },
}));

describe('prisma-tenant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejeita contaId vazio', async () => {
    const { runWithTenant } = await import('@/lib/prisma-tenant');

    await expect(runWithTenant('  ', async () => null)).rejects.toThrow(
      'contaId is required for tenant-scoped database access',
    );
  });

  it('define app.current_conta_id na transação quando RLS runtime está desligado', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'false');
    const { runWithTenant, isRlsRuntimeEnabled } = await import('@/lib/prisma-tenant');

    expect(isRlsRuntimeEnabled()).toBe(false);

    await runWithTenant('conta-abc', async () => 'ok');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalled();
  });

  it('exige DATABASE_RLS_URL quando RLS runtime está ligado', async () => {
    vi.stubEnv('RLS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('DATABASE_RLS_URL', '');
    const { runWithTenant } = await import('@/lib/prisma-tenant');

    await expect(runWithTenant('conta-abc', async () => null)).rejects.toThrow(
      'DATABASE_RLS_URL is required when RLS_RUNTIME_ENABLED=true',
    );
  });
});
