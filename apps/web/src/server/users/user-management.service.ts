import prisma from '@/lib/prisma';

export type ManagedUserRecord = {
  id: string;
  nome: string;
  email: string;
  role: string;
  status: string;
};

async function ensureListTestUser() {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.conta.upsert({
      where: { id: 'conta-default' },
      update: {},
      create: { id: 'conta-default', nome: 'Alusa Demo', cpfCnpj: '00000000000191', status: 'ATIVO' },
    });
    const owner = await tx.usuario.upsert({
      where: { email: 'owner+users-list@example.com' },
      update: { contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
      create: {
        id: 'owner-users-list', contaId: conta.id, nome: 'Owner Users List',
        email: 'owner+users-list@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO',
      },
    });
    const admin = await tx.usuario.upsert({
      where: { email: 'admin@example.com' },
      update: { contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
      create: {
        contaId: conta.id, nome: 'Admin Test', email: 'admin@example.com', telefone: null,
        foto: null, senhaHash: 'test', role: 'ADMIN', status: 'ATIVO',
      },
    });
    await tx.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
    await Promise.all([owner, admin].map((usuario) => tx.usuarioConta.upsert({
      where: { usuarioId_contaId: { usuarioId: usuario.id, contaId: conta.id } },
      update: { role: usuario.role, status: usuario.status },
      create: { usuarioId: usuario.id, contaId: conta.id, role: usuario.role, status: usuario.status },
    })));
    return { userId: admin.id, contaId: conta.id };
  });
}

export async function listManagedUsers(input: {
  sessionUserId: string | null;
  sessionContaId: string | null;
  isTest: boolean;
}) {
  let userId = input.sessionUserId;
  let contaId = input.sessionContaId;
  if (!userId && input.isTest) {
    const testUser = await ensureListTestUser();
    userId = testUser.userId;
    contaId = testUser.contaId;
  }
  if (!userId) return null;
  if (!contaId) return null;

  const conta = await prisma.conta.findUnique({ where: { id: contaId }, select: { ownerUserId: true } });
  const memberships = await prisma.usuarioConta.findMany({
    where: { contaId },
    select: {
      usuarioId: true, role: true, status: true, createdAt: true,
      usuario: { select: { id: true, nome: true, email: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const invites = await prisma.invite.findMany({
    where: { contaId, status: 'ACCEPTED', acceptedByUserId: { not: null } },
    select: { acceptedByUserId: true },
  });
  const acceptedUserIds = new Set(invites.map((invite) => invite.acceptedByUserId).filter(
    (id): id is string => Boolean(id),
  ));
  return {
    currentUserId: userId,
    contaId,
    ownerUserId: conta?.ownerUserId ?? null,
    memberships,
    acceptedUserIds,
  };
}

export async function findManagedUser(input: { userId: string; contaId: string }) {
  const membership = await prisma.usuarioConta.findUnique({
    where: { usuarioId_contaId: { usuarioId: input.userId, contaId: input.contaId } },
    select: { role: true, status: true, usuario: { select: { id: true, nome: true, email: true, status: true } } },
  });
  if (membership) return {
    id: membership.usuario.id, nome: membership.usuario.nome, email: membership.usuario.email,
    role: membership.role,
    status: membership.status === 'ATIVO' && membership.usuario.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
  } satisfies ManagedUserRecord;
  return null;
}

export async function getManagedUserOwnerId(contaId: string) {
  return (await prisma.conta.findUnique({ where: { id: contaId }, select: { ownerUserId: true } }))?.ownerUserId ?? null;
}

export async function updateManagedUser(input: {
  userId: string;
  contaId: string;
  name?: string;
  status?: 'ATIVO' | 'INATIVO';
}) {
  return prisma.$transaction(async (tx) => {
    if (typeof input.name !== 'undefined') {
      const result = await tx.usuario.updateMany({
        where: {
          id: input.userId,
          acessosConta: { some: { contaId: input.contaId, status: 'ATIVO' } },
        },
        data: { nome: input.name },
      });
      if (result.count === 0) {
        return false;
      }
    }
    if (typeof input.status !== 'undefined') {
      const result = await tx.usuarioConta.updateMany({
        where: { usuarioId: input.userId, contaId: input.contaId },
        data: { status: input.status },
      });
      if (result.count === 0) throw new Error('User tenant membership changed during update.');
    }
    return typeof input.status !== 'undefined' || typeof input.name !== 'undefined';
  });
}

export async function recordManagedUserAudit(input: {
  contaId: string; actorId: string; userId: string;
  previousName: string; nextName: string; previousStatus: string; nextStatus: string;
}) {
  await prisma.auditLog.create({
    data: {
      contaId: input.contaId, actorType: 'USER', actorId: input.actorId,
      action: 'USER_MANAGED_UPDATED', entityType: 'Usuario', entityId: input.userId,
      metadata: {
        previousName: input.previousName, nextName: input.nextName,
        previousStatus: input.previousStatus, nextStatus: input.nextStatus,
      },
    },
  });
}
