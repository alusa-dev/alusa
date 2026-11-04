import { beforeEach, describe, expect, it, vi } from 'vitest';

type MembershipRow = { usuarioId: string; contaId: string; role: string; status: string };
type MembershipUpsertArgs = {
  where: { usuarioId_contaId: { usuarioId: string; contaId: string } };
  update: { status: string };
  create: MembershipRow;
};

const { prismaMock, transactionMock, membershipDeleteManyMock, membershipUpdateManyMock, auditCreateMock, membershipState, collaboratorAccessLinks, responsibles, responsavelUpdateManyMock, setDeleteCountOverride } = vi.hoisted(() => {
  const membershipState = new Map<string, MembershipRow>();
  const collaboratorAccessLinks = new Map<string, boolean>();
  const responsibles = new Map<string, { id: string; contaId: string; usuarioId: string | null; academicData: string }>();
  let deleteCountOverride: number | null = null;
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
  const membershipDeleteManyMock = vi.fn(async (args: { where: { usuarioId: string; contaId: string } }) => {
    const key = `${args.where.usuarioId}:${args.where.contaId}`;
    if (deleteCountOverride !== null) return { count: deleteCountOverride };
    return { count: membershipState.delete(key) ? 1 : 0 };
  });
  const collaboratorUpdateManyMock = vi.fn(async (args: { where: { usuarioId: string; contaId: string }; data: { usuarioId: null; temAcesso: false } }) => {
    const key = `${args.where.usuarioId}:${args.where.contaId}`;
    if (collaboratorAccessLinks.has(key)) collaboratorAccessLinks.set(key, false);
    return { count: 1 };
  });
  const responsavelUpdateManyMock = vi.fn(async (args: { where: { usuarioId: string; contaId: string }; data: { usuarioId: null } }) => {
    let count = 0;
    for (const [id, row] of responsibles) {
      if (row.usuarioId === args.where.usuarioId && row.contaId === args.where.contaId) {
        responsibles.set(id, { ...row, ...args.data });
        count++;
      }
    }
    return { count };
  });
  const userUpdateManyMock = vi.fn(async (args?: { where?: { id?: string; acessosConta?: { some?: { contaId?: string; status?: string } } } }) => {
    const scope = args?.where?.acessosConta?.some;
    if (scope && membershipState.get(`${args?.where?.id}:${scope.contaId}`)?.status !== scope.status) return { count: 0 };
    return { count: 1 };
  });
  const auditCreateMock = vi.fn();
  const transactionMock = vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => {
    const snapshot = new Map(membershipState);
    const collaboratorSnapshot = new Map(collaboratorAccessLinks);
    const responsiblesSnapshot = new Map(responsibles);
    try {
      return await callback({
        usuarioConta: {
          findUnique: vi.fn(async (args: { where: { usuarioId_contaId: { usuarioId: string; contaId: string } } }) => {
            const { usuarioId, contaId } = args.where.usuarioId_contaId;
            const row = membershipState.get(`${usuarioId}:${contaId}`);
            return row ? { ...row, usuario: user } : null;
          }),
          upsert: membershipUpsertMock,
          updateMany: membershipUpdateManyMock,
          deleteMany: membershipDeleteManyMock,
        },
        colaborador: { updateMany: collaboratorUpdateManyMock },
        responsavel: {
          findMany: vi.fn(async (args: { where: { usuarioId: string; contaId: string } }) => [...responsibles.values()]
            .filter((row) => row.usuarioId === args.where.usuarioId && row.contaId === args.where.contaId)
            .map(({ id }) => ({ id }))),
          updateMany: responsavelUpdateManyMock,
        },
        usuario: { updateMany: userUpdateManyMock },
        auditLog: { create: auditCreateMock },
      });
    } catch (error) {
      membershipState.clear();
      for (const [key, value] of snapshot) membershipState.set(key, value);
      collaboratorAccessLinks.clear();
      for (const [key, value] of collaboratorSnapshot) collaboratorAccessLinks.set(key, value);
      responsibles.clear();
      for (const [key, value] of responsiblesSnapshot) responsibles.set(key, value);
      throw error;
    }
  });
  return {
    membershipDeleteManyMock,
    membershipUpdateManyMock,
    auditCreateMock,
    transactionMock,
    membershipState,
    collaboratorAccessLinks,
    responsibles,
    responsavelUpdateManyMock,
    setDeleteCountOverride: (count: number | null) => { deleteCountOverride = count; },
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
        findMany: vi.fn(async (args: { where: { usuarioId: string; status: string } }) => [...membershipState.values()]
          .filter((row) => row.usuarioId === args.where.usuarioId && row.status === args.where.status)
          .map((row) => ({ contaId: row.contaId, role: row.role, conta: { nome: row.contaId } }))),
        updateMany: membershipUpdateManyMock,
        deleteMany: membershipDeleteManyMock,
      },
      authCredential: { findUnique: vi.fn(async () => ({ user: { id: 'user-1', status: 'ATIVO' }, emailVerifiedAt: new Date(), sessionVersion: 1 })) },
      usuario: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: userUpdateManyMock, delete: vi.fn() },
      colaborador: { updateMany: collaboratorUpdateManyMock },
      responsavel: { updateMany: responsavelUpdateManyMock },
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
    collaboratorAccessLinks.clear();
    responsibles.clear();
    setDeleteCountOverride(null);
    auditCreateMock.mockResolvedValue({});
    prismaMock.usuario.findFirst.mockResolvedValue(user);
    prismaMock.usuario.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null, sessionVersion: 1 });
  });

  it('exclui permanentemente somente a membership da conta e registra snapshot de auditoria', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    responsibles.set('guardian-a', { id: 'guardian-a', contaId: 'school-a', usuarioId: user.id, academicData: 'preserved' });
    responsibles.set('guardian-b', { id: 'guardian-b', contaId: 'school-b', usuarioId: user.id, academicData: 'other tenant' });

    const result = await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1', reason: 'Solicitação' });

    expect(result).toEqual({ id: user.id, hard: true });
    expect(membershipDeleteManyMock).toHaveBeenCalledWith({ where: {
      usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO',
    } });
    expect(prismaMock.colaborador.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: user.id, contaId: 'school-a' },
      data: { usuarioId: null, temAcesso: false },
    });
    expect(responsavelUpdateManyMock).toHaveBeenCalledWith({
      where: { usuarioId: user.id, contaId: 'school-a' }, data: { usuarioId: null },
    });
    expect(responsibles.get('guardian-a')).toEqual({ id: 'guardian-a', contaId: 'school-a', usuarioId: null, academicData: 'preserved' });
    expect(responsibles.get('guardian-b')).toEqual({ id: 'guardian-b', contaId: 'school-b', usuarioId: user.id, academicData: 'other tenant' });
    expect(auditCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'school-a',
        actorId: 'admin-1',
        action: 'USER_TENANT_ACCESS_DELETED',
        entityType: 'UsuarioConta',
        metadata: expect.objectContaining({ userId: user.id, userEmail: user.email, userName: user.nome, actorId: 'admin-1', reason: 'Solicitação', unlinkedResponsavelIds: ['guardian-a'], unlinkedResponsavelCount: 1 }),
      }),
    }));
    expect(prismaMock.usuario.delete).not.toHaveBeenCalled();
    expect(prismaMock.responsavel.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.aluno.updateMany).not.toHaveBeenCalled();
  });

  it('não fabrica membership para uma identidade legada sem membership', async () => {
    membershipState.clear();

    const result = await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1' });

    expect(result).toBeNull();
    expect(membershipDeleteManyMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('não altera nada quando usuário não pertence à conta solicitada', async () => {
    membershipState.clear();
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    expect(await removeManagedUserAccess({ userId: user.id, contaId: 'school-b', actorId: 'admin-1' })).toBeNull();
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it('mantém intacta a membership da escola B ao excluir A', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    membershipState.set(`${user.id}:school-b`, { usuarioId: user.id, contaId: 'school-b', role: 'ADMIN', status: 'ATIVO' });
    prismaMock.usuario.findFirst.mockResolvedValue(null);

    await removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-a' });

    expect(membershipState.has(`${user.id}:school-a`)).toBe(false);
    expect(membershipState.get(`${user.id}:school-b`)).toEqual({
      usuarioId: user.id, contaId: 'school-b', role: 'ADMIN', status: 'ATIVO',
    });
    await expect(resolveSessionAccess({ userId: user.id, contaId: 'school-b', sessionVersion: 1, authContext: 'COLLABORATOR' }))
      .resolves.toMatchObject({ ok: true, contaId: 'school-b', role: 'ADMIN' });
  });

  it('reverte a exclusão quando a criação do audit log falha', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    responsibles.set('guardian-a', { id: 'guardian-a', contaId: 'school-a', usuarioId: user.id, academicData: 'preserved' });
    auditCreateMock.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1' }))
      .rejects.toThrow('audit unavailable');

    expect(membershipState.get(`${user.id}:school-a`)?.status).toBe('ATIVO');
    expect(membershipState.size).toBe(1);
    expect(responsibles.get('guardian-a')?.usuarioId).toBe(user.id);
    expect(responsibles.get('guardian-a')?.academicData).toBe('preserved');
  });

  it('não grava snapshot nem mantém desvinculação se a membership mudar concorrentemente', async () => {
    membershipState.set(`${user.id}:school-a`, { usuarioId: user.id, contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    collaboratorAccessLinks.set(`${user.id}:school-a`, true);
    setDeleteCountOverride(0);

    await expect(removeManagedUserAccess({ userId: user.id, contaId: 'school-a', actorId: 'admin-1' })).resolves.toBeNull();

    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(collaboratorAccessLinks.get(`${user.id}:school-a`)).toBe(true);
    expect(membershipState.has(`${user.id}:school-a`)).toBe(true);
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
