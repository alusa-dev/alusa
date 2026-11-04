import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    authCredential: { findUnique: vi.fn() },
    conta: { findUnique: vi.fn() },
    usuarioConta: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

import { resolveSessionAccess } from '@/lib/auth-service';

describe('auth-service tenant membership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authCredential.findUnique.mockResolvedValue({
      user: { id: 'user-1', status: 'ATIVO' }, emailVerifiedAt: new Date(), sessionVersion: 1,
    });
  });

  it('denies a membership-less user even when legacy defaults point at an active account', async () => {
    prismaMock.usuarioConta.findFirst.mockResolvedValue(null);
    prismaMock.conta.findUnique.mockResolvedValue({ status: 'ATIVO', deletedAt: null });

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'legacy-school', sessionVersion: 1, authContext: 'COLLABORATOR' }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.authCredential.findUnique).toHaveBeenCalledWith({
      where: { uq_auth_credential_context_user: { context: 'COLLABORATOR', userId: 'user-1' } },
      select: { user: { select: { id: true, status: true } }, emailVerifiedAt: true, sessionVersion: true },
    });
    expect(prismaMock.conta.findUnique).not.toHaveBeenCalled();
  });

  it('denies a suspended membership instead of reopening access from legacy defaults', async () => {
    prismaMock.usuarioConta.findFirst.mockResolvedValue(null);

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'legacy-school', sessionVersion: 1, authContext: 'COLLABORATOR' }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.usuarioConta.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ usuarioId: 'user-1', status: 'ATIVO', contaId: 'legacy-school' }),
    }));
  });

  it('denies the suspended school A while continuing to authorize active school B with its membership role', async () => {
    prismaMock.usuarioConta.findFirst.mockImplementation(async (args: { where: { contaId?: string } }) => {
      if (args.where.contaId === 'school-b') {
        return { contaId: 'school-b', role: 'FINANCEIRO', conta: { status: 'ATIVO', deletedAt: null } };
      }
      return null;
    });
    prismaMock.usuarioConta.findMany.mockResolvedValue([
      { contaId: 'school-b', role: 'FINANCEIRO', conta: { nome: 'School B' } },
    ] as never);

    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'school-a', sessionVersion: 1, authContext: 'COLLABORATOR' }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    await expect(resolveSessionAccess({ userId: 'user-1', contaId: 'school-b', sessionVersion: 1, authContext: 'COLLABORATOR' }))
      .resolves.toMatchObject({ ok: true, contaId: 'school-b', role: 'FINANCEIRO' });
  });
});
