import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: { findUnique: vi.fn() },
    conta: { findUnique: vi.fn() },
    usuarioConta: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

describe('auth-service tenant membership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps legacy fallback only for users without membership records', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({
      id: 'user-1', status: 'ATIVO', contaId: 'legacy-school', role: 'ADMIN',
      emailVerifiedAt: new Date(), sessionVersion: 1,
    });
    prismaMock.usuarioConta.findFirst.mockResolvedValue(null);
    prismaMock.conta.findUnique.mockResolvedValue({ status: 'ATIVO', deletedAt: null });
    const { resolveSessionAccess } = await import('@/lib/auth-service');

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'legacy-school', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: true, contaId: 'legacy-school', role: 'ADMIN' });
  });

  it('does not restore a revoked primary-school access through legacy Usuario.contaId', async () => {
    prismaMock.usuario.findUnique.mockResolvedValue({
      id: 'user-1', status: 'ATIVO', contaId: 'school-a', role: 'ADMIN',
      emailVerifiedAt: new Date(), sessionVersion: 1,
    });
    prismaMock.usuarioConta.findFirst
      .mockResolvedValueOnce(null) // no active membership on school A
      .mockResolvedValueOnce({ contaId: 'school-b' }); // membership exists elsewhere
    const { resolveSessionAccess } = await import('@/lib/auth-service');

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'school-a', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.conta.findUnique).not.toHaveBeenCalled();
  });
});
