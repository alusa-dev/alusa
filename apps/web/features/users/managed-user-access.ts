import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';

export const REMOVED_USER_EMAIL_PREFIX = 'removed-user+';
export const REMOVED_USER_EMAIL_DOMAIN = '@alusa.invalid';

export function buildRemovedUserEmail(userId: string) {
  return `${REMOVED_USER_EMAIL_PREFIX}${userId}${REMOVED_USER_EMAIL_DOMAIN}`;
}

export function isRemovedUserEmail(email: string | null | undefined) {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return (
    normalizedEmail.startsWith(REMOVED_USER_EMAIL_PREFIX) &&
    normalizedEmail.endsWith(REMOVED_USER_EMAIL_DOMAIN)
  );
}

async function buildRemovedUserPasswordHash(userId: string) {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const pepper = process.env.BCRYPT_PEPPER || '';
  return bcrypt.hash(`removed-user:${userId}:${randomUUID()}:${pepper}`, rounds);
}

export async function removeManagedUserAccess(input: {
  userId: string;
  contaId: string;
  actorId: string;
  reason?: string | null;
}) {
  const membershipClient = (prisma as unknown as {
    usuarioConta?: {
      findUnique: (_args: unknown) => Promise<{
        usuarioId: string;
        contaId: string;
        role: string;
        status: string;
        usuario: {
          id: string;
          contaId: string;
          nome: string;
          email: string;
          role: string;
          status: string;
        };
      } | null>;
      count: (_args: unknown) => Promise<number>;
      updateMany: (_args: unknown) => Promise<{ count: number }>;
    };
  }).usuarioConta;

  const membership = membershipClient?.findUnique
    ? await membershipClient.findUnique({
        where: { usuarioId_contaId: { usuarioId: input.userId, contaId: input.contaId } },
        select: {
          usuarioId: true,
          contaId: true,
          role: true,
          status: true,
          usuario: {
            select: { id: true, contaId: true, nome: true, email: true, role: true, status: true },
          },
        },
      })
    : null;

  const user = membership?.usuario ?? (await prisma.usuario.findFirst({
    where: { id: input.userId, contaId: input.contaId },
    select: {
      id: true,
      contaId: true,
      nome: true,
      email: true,
      role: true,
      status: true,
    },
  }));

  if (!user) {
    return null;
  }

  const membershipCount = membershipClient?.count
    ? await membershipClient.count({ where: { usuarioId: user.id } })
    : 0;
  const shouldRemoveMembershipOnly =
    Boolean(membership) && (user.contaId !== input.contaId || membershipCount > 1);

  if (shouldRemoveMembershipOnly && membershipClient?.updateMany) {
    const removedAt = new Date();
    const correlationId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.colaborador.updateMany({ where: { contaId: input.contaId, usuarioId: user.id }, data: { usuarioId: null } }),
        tx.responsavel.updateMany({ where: { contaId: input.contaId, usuarioId: user.id }, data: { usuarioId: null } }),
        tx.aluno.updateMany({ where: { contaId: input.contaId, usuarioId: user.id }, data: { usuarioId: null } }),
      ]);

      await tx.usuarioConta.updateMany({
        where: { usuarioId: user.id, contaId: input.contaId },
        data: { status: 'INATIVO' },
      });

      await tx.auditLog.create({
        data: {
          contaId: input.contaId,
          actorType: 'USER',
          actorId: input.actorId,
          action: 'USER_TENANT_ACCESS_REMOVED',
          entityType: 'UsuarioConta',
          entityId: user.id,
          correlationId,
          metadata: {
            removedAt: removedAt.toISOString(),
            removedUserEmail: user.email,
            removedUserName: user.nome,
            removedUserRole: membership?.role ?? user.role,
            reason: input.reason?.trim() || null,
          },
        },
      });
    });

    return {
      id: user.id,
      hard: false,
      alreadyRemoved: membership?.status === 'INATIVO',
    };
  }

  if (isRemovedUserEmail(user.email)) {
    return {
      id: user.id,
      hard: true,
      alreadyRemoved: true,
    };
  }

  const removedAt = new Date();
  const removedEmail = buildRemovedUserEmail(user.id);
  const removedPasswordHash = await buildRemovedUserPasswordHash(user.id);
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.authActionToken.deleteMany({ where: { userId: user.id } }),
      tx.colaborador.updateMany({ where: { usuarioId: user.id }, data: { usuarioId: null } }),
      tx.responsavel.updateMany({ where: { usuarioId: user.id }, data: { usuarioId: null } }),
      tx.aluno.updateMany({ where: { usuarioId: user.id }, data: { usuarioId: null } }),
    ]);

    await tx.usuario.update({
      where: { id: user.id },
      data: {
        email: removedEmail,
        senhaHash: removedPasswordHash,
        emailVerifiedAt: null,
        status: 'INATIVO',
        telefone: null,
        foto: null,
      },
    });

    await tx.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorId,
        action: 'USER_ACCESS_REMOVED',
        entityType: 'Usuario',
        entityId: user.id,
        correlationId,
        metadata: {
          removedAt: removedAt.toISOString(),
          removedUserEmail: user.email,
          removedUserName: user.nome,
          removedUserRole: user.role,
          reason: input.reason?.trim() || null,
        },
      },
    });
  });

  return {
    id: user.id,
    hard: true,
    alreadyRemoved: false,
  };
}
