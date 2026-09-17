import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type ManagedUserRecord = {
  id: string;
  nome: string;
  email: string;
  role: string;
  status: string;
  viaMembership: boolean;
};

async function ensureListTestUser() {
  const conta = await prisma.conta.upsert({
    where: { id: 'conta-default' },
    update: {},
    create: { id: 'conta-default', nome: 'Alusa Demo', cpfCnpj: '00000000000191', status: 'ATIVO' },
  });
  const owner = await prisma.usuario.upsert({
    where: { email: 'owner+users-list@example.com' },
    update: {},
    create: {
      id: 'owner-users-list', contaId: conta.id, nome: 'Owner Users List',
      email: 'owner+users-list@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO',
    },
  });
  if (conta.ownerUserId !== owner.id) {
    await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
  }
  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      contaId: conta.id, nome: 'Admin Test', email: 'admin@example.com', telefone: null,
      foto: null, senhaHash: 'test', role: 'ADMIN', status: 'ATIVO',
    },
  });
  return { userId: admin.id, contaId: conta.id };
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
  if (!contaId) {
    contaId = (await prisma.usuario.findUnique({ where: { id: userId }, select: { contaId: true } }))?.contaId ?? null;
  }
  if (!contaId) return null;

  const conta = await prisma.conta.findUnique({ where: { id: contaId }, select: { ownerUserId: true } });
  const membershipClient = (prisma as unknown as {
    usuarioConta?: {
      findMany: (_args: unknown) => Promise<Array<{
        usuarioId: string; role: string; status: string; createdAt: Date;
        usuario: { id: string; nome: string; email: string; status: string; createdAt: Date };
      }>>;
    };
  }).usuarioConta;
  const memberships = membershipClient?.findMany ? await membershipClient.findMany({
    where: { contaId },
    select: {
      usuarioId: true, role: true, status: true, createdAt: true,
      usuario: { select: { id: true, nome: true, email: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  }) : [];
  const membershipUserIds = new Set(memberships.map((item) => item.usuarioId));
  const legacyUsers = await prisma.usuario.findMany({
    where: { contaId },
    select: { id: true, nome: true, email: true, role: true, status: true, createdAt: true },
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
    legacyUsers: legacyUsers.filter((user) => !membershipUserIds.has(user.id)),
    acceptedUserIds,
  };
}

export async function findManagedUser(input: { userId: string; contaId: string }) {
  const membershipClient = (prisma as unknown as {
    usuarioConta?: {
      findUnique: (_args: unknown) => Promise<{
        role: string; status: string;
        usuario: { id: string; nome: string; email: string; status: string };
      } | null>;
    };
  }).usuarioConta;
  const membership = membershipClient?.findUnique ? await membershipClient.findUnique({
    where: { usuarioId_contaId: { usuarioId: input.userId, contaId: input.contaId } },
    select: { role: true, status: true, usuario: { select: { id: true, nome: true, email: true, status: true } } },
  }) : null;
  if (membership) return {
    id: membership.usuario.id, nome: membership.usuario.nome, email: membership.usuario.email,
    role: membership.role,
    status: membership.status === 'ATIVO' && membership.usuario.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
    viaMembership: true,
  } satisfies ManagedUserRecord;
  const legacy = await prisma.usuario.findFirst({
    where: { id: input.userId, contaId: input.contaId },
    select: { id: true, nome: true, email: true, role: true, status: true },
  });
  return legacy ? { ...legacy, viaMembership: false } satisfies ManagedUserRecord : null;
}

export async function getManagedUserOwnerId(contaId: string) {
  return (await prisma.conta.findUnique({ where: { id: contaId }, select: { ownerUserId: true } }))?.ownerUserId ?? null;
}

export async function updateManagedUser(input: {
  userId: string;
  contaId: string;
  viaMembership: boolean;
  data: Prisma.UsuarioUpdateManyMutationInput;
  name?: string;
  status?: string;
}) {
  const membershipClient = (prisma as unknown as {
    usuarioConta?: { updateMany: (_args: unknown) => Promise<{ count: number }> };
  }).usuarioConta;
  if (input.viaMembership) {
    if (typeof input.name !== 'undefined') {
      await prisma.usuario.updateMany({
        where: { id: input.userId, acessosConta: { some: { contaId: input.contaId, status: 'ATIVO' } } },
        data: { nome: input.name },
      });
    }
    if (typeof input.status !== 'undefined' && membershipClient?.updateMany) {
      const result = await membershipClient.updateMany({
        where: { usuarioId: input.userId, contaId: input.contaId },
        data: { status: input.status },
      });
      if (result.count === 0) return false;
    }
  } else {
    const result = await prisma.usuario.updateMany({
      where: { id: input.userId, contaId: input.contaId }, data: input.data,
    });
    if (result.count === 0) return false;
  }
  return true;
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
