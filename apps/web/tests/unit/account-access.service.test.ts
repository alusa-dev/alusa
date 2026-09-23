import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { usuarioConta: { findMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

describe('listActiveAccountsForUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only active memberships to non-deleted active accounts in access order', async () => {
    prismaMock.usuarioConta.findMany.mockResolvedValue([]);
    const { listActiveAccountsForUser } = await import('@/src/server/users/account-access.service');

    await expect(listActiveAccountsForUser('user-1')).resolves.toEqual([]);
    expect(prismaMock.usuarioConta.findMany).toHaveBeenCalledWith({
      where: {
        usuarioId: 'user-1',
        status: 'ATIVO',
        conta: { status: 'ATIVO', deletedAt: null },
      },
      select: {
        contaId: true,
        role: true,
        conta: { select: { nome: true } },
      },
      orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'asc' }],
    });
  });
});
