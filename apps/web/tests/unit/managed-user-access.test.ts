import { beforeEach, describe, expect, it, vi } from 'vitest';

type MembershipRow = { usuarioId: string; contaId: string; role: string; status: string };
type MembershipUpsertArgs = {
  where: { usuarioId_contaId: { usuarioId: string; contaId: string } };
  update: { status: string };
  create: MembershipRow;
};

const { prismaMock, transactionMock, membershipUpsertMock, membershipUpdateManyMock, auditCreateMock, membershipState } = vi.hoisted(() => {
  const membershipState = new Map<string, MembershipRow>();
  const membershipUpsertMock = vi.fn(async (args: MembershipUpsertArgs) => {
    const { usuarioId, contaId } = args.where.usuarioId_contaId;
    const key = `${usuarioId}:${contaId}`;
    const current = membershipState.get(key);
    membershipState.set(key, { ...(current ?? args.create), ...args.update });
    return membershipState.get(key);
  });
  const membershipUpdateManyMock = vi.fn(async (args: { where: { usuarioId: string; contaId: string }; data: { status: string } }) => {
    const key = `${args.where.usuarioId}:${args.where.contaId}`;
    const current = membershipState.get(key);
    if (!current) return { count: 0 };
    membershipState.set(key, { ...current, ...args.data });
    return { count: 1 };
  });
  const userUpdateManyMock = vi.fn(async (args?: { where?: { id?: string; acessosConta?: { some?: { contaId?: string; status?: string } } } }) => {
    const scope = args?.where?.acessosConta?.some;
    if (scope && membershipState.get(`${args?.where?.id}:${scope.contaId}`)?.status !== scope.status) return { count: 0 };
    return { count: 1 };
  });
  const auditCreateMock = vi.fn();
  const transactionMock = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const snapshot = new Map(membershipState);
    try {
      return await callback({
        usuarioConta: { upsert: membershipUpsertMock, updateMany: membershipUpdateManyMock },
        usuario: { updateMany: userUpdateManyMock },
        auditLog: { create: auditCreateMock },
      });
    } catch (error) {
      membershipState.clear();
      for (const [key, value] of snapshot) membershipState.set(key, value);
      throw error;
    }
  });
  return {
    membershipUpsertMock,
    membershipUpdateManyMock,
    auditCreateMock,
    transactionMock,
    membershipState,
    prismaMock: {
      usuarioConta: {
        findUnique: vi.fn(async (args: { where: MembershipUpsertArgs['where'] }) => {
          const { usuarioId, contaId } = args.where.usuarioId_contaId;
          const row = membershipState.get(`${usuarioId}:${contaId}`);
          return row ? { ...row, usuario: user } : null;
        }),
        findFirst: vi.fn(async (args: { where: { usuarioId: string; contaId?: string; status?: string } }) => {
          const where = args.where;
          const row = where.contaId
            ? membershipState.get(`${where.usuarioId}:${where.contaId}`)
            : [...membershipState.values()].find((item) => item.usuarioId === where.usuarioId);
          if (!row || (where.status && row.status !== where.status)) return null;
          return { ...row, conta: { status: 'ATIVO', deletedAt: null } };
        }),
        updateMany: membershipUpdateManyMock,
      },
      usuario: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: userUpdateManyMock, delete: vi.fn() },
      colaborador: { updateMany: vi.fn() },
      responsavel: { updateMany: vi.fn() },
      aluno: { updateMany: vi.fn() },
      conta: { findUnique: vi.fn().mockResolvedValue({ status: 'ATIVO', deletedAt: null }) },
      $transaction: transactionMock,
    },
  };
});

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

import { removeManagedUserAccess } from '@/features/users/managed-user-access';
import { updateManagedUser } from '@/src/server/users/user-management.service';
import { resolveSessionAccess } from '@/lib/auth-service';

const user = {
  id: 'user-1', contaId: 'school-a', nome: 'Taylor', email: 'taylor@example.com', role: 'PROFESSOR', status: 'ATIVO',
};

describe('removeManagedUserAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipState.clear();
    auditCreateMock.mockResolvedValue({});
    prismaMock.usuario.findFirst.mockResolvedValue(user);
    prismaMock.usuario.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null, sessionVersion: 1 });
  });

  it('suspende a membership sem chamar operações que desvinculem relações ou excluam a identidade', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });

    const result = await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1', reason: 'Solicitação' });

    expect(result).toEqual({ id: user.id, hard: false, alreadyRemoved: false });
    expect(membershipUpsertMock).toHaveBeenCalledWith({
      where: { usuarioId_contaId: { usuarioId: user.id, contaId: 'school-a' } },
      update: { status: 'INATIVO' },
      create: { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'INATIVO' },
    });
    expect(auditCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'school-a',
        action: 'USER_TENANT_ACCESS_SUSPENDED',
        entityType: 'UsuarioConta',
        metadata: expect.objectContaining({ userId: user.id, reason: 'Solicitação' }),
      }),
    }));
    expect(prismaMock.usuario.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.usuario.delete).not.toHaveBeenCalled();
    expect(prismaMock.colaborador.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.responsavel.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.aluno.updateMany).not.toHaveBeenCalled();
  });

  it('cria uma membership suspensa para registro legado e permite reativação pelo mesmo registro', async () => {
    membershipState.clear();

    const result = await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1' });

    expect(result?.hard).toBe(false);
    expect(membershipUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuarioId_contaId: { usuarioId: user.id, contaId: 'school-a' } },
      create: { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'INATIVO' },
    }));
    expect(prismaMock.usuario.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: user.id, contaId: 'school-a' },
    }));
  });

  it('não altera nada quando usuário não pertence à conta solicitada', async () => {
    membershipState.clear();
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    expect(await removeManagedUserAccess({ userId: user.id, contaId: 'school-b', actorId: 'admin-1' })).toBeNull();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('mantém a escola B ativa e nega A após suspender somente A', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    membershipState.set(`${user.id}:school-b`, { usuarioId: user.id, contaId: 'school-b', role: 'ADMIN', status: 'ATIVO' });
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-a' });

    expect(membershipState.get(`${user.id}:school-a`)?.status).toBe('INATIVO');
    expect(membershipState.get(`${user.id}:school-b`)).toEqual({
      usuarioId: user.id, contaId: 'school-b', role: 'ADMIN', status: 'ATIVO',
    });
    await expect(resolveSessionAccess({ userId: user.id, contaId: 'school-a', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    await expect(resolveSessionAccess({ userId: user.id, contaId: 'school-b', sessionVersion: 1 }))
      .resolves.toMatchObject({ ok: true, contaId: 'school-b', role: 'ADMIN' });
  });

  it('reverte a suspensão quando a criação do audit log falha', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    auditCreateMock.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1' }))
      .rejects.toThrow('audit unavailable');

    expect(membershipState.get(`${user.id}:school-a`)?.status).toBe('ATIVO');
    expect(membershipState.size).toBe(1);
  });

  it('reativa o acesso da escola pelo PATCH autorizado existente', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'INATIVO' });
    const updated = await updateManagedUser({
      userId: user.id,
      contaId: 'school-a',
      status: 'ATIVO',
    });

    expect(updated).toBe(true);
    expect(membershipUpdateManyMock).toHaveBeenCalledWith({
      where: { usuarioId: user.id, contaId: 'school-a' },
      data: { status: 'ATIVO' },
    });
  });

  it('não permite que membership inativa altere nome global da identidade', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'INATIVO' });

    const updated = await updateManagedUser({ userId: user.id, contaId: 'school-a', name: 'Nome alterado' });

    expect(updated).toBe(false);
    expect(prismaMock.usuario.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, acessosConta: { some: { contaId: 'school-a', status: 'ATIVO' } } },
      data: { nome: 'Nome alterado' },
    });
  });
});
