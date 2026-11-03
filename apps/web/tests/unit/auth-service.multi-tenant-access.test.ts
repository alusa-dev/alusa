import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: { findUnique: vi.fn() },
    conta: { findUnique: vi.fn() },
    usuarioConta: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

import { resolveSessionAccess } from '@/lib/auth-service';

describe('auth-service tenant membership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.usuario.findUnique.mockResolvedValue({
      id: 'user-1', status: 'ATIVO', emailVerifiedAt: new Date(), sessionVersion: 1,
      // Legacy defaults must never grant access or supply the role.
      contaId: 'legacy-school', role: 'ADMIN',
    });
  });

  it('denies a membership-less user even when legacy defaults point at an active account', async () => {
    prismaMock.usuarioConta.findFirst.mockResolvedValue(null);
    prismaMock.conta.findUnique.mockResolvedValue({ status: 'ATIVO', deletedAt: null });

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'legacy-school', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.conta.findUnique).not.toHaveBeenCalled();
  });

  it('denies a suspended membership instead of reopening access from legacy defaults', async () => {
    prismaMock.usuarioConta.findFirst.mockResolvedValue(null);

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'legacy-school', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.usuarioConta.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId: 'user-1', status: 'ATIVO', contaId: 'legacy-school' },
    }));
  });

  it('denies the suspended school A while continuing to authorize active school B with its membership role', async () => {
    prismaMock.usuarioConta.findFirst.mockImplementation(async (args: { where: { contaId?: string } }) => {
      if (args.where.contaId === 'school-b') {
        return { contaId: 'school-b', role: 'FINANCEIRO', conta: { status: 'ATIVO', deletedAt: null } };
      }
      return null;
    });

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'school-a', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'school-b', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: true, contaId: 'school-b', role: 'FINANCEIRO' });
  });
});
