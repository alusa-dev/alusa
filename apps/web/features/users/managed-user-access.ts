import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';

export const REMOVED_USER_EMAIL_PREFIX = 'removed-user+';
export const REMOVED_USER_EMAIL_DOMAIN = '@alusa.invalid';

export function isRemovedUserEmail(email: string | null | undefined) {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.startsWith(REMOVED_USER_EMAIL_PREFIX) &&
    normalizedEmail.endsWith(REMOVED_USER_EMAIL_DOMAIN);
}

/** Removes a user's access to one school while preserving the identity and its history. */
export async function removeManagedUserAccess(input: {
  userId: string;
  contaId: string;
  actorId: string;
  reason?: string | null;
}) {
  const membership = await prisma.usuarioConta.findUnique({
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
  });
  const user = membership?.usuario ?? (await prisma.usuario.findFirst({
    where: { id: input.userId, contaId: input.contaId },
    select: { id: true, contaId: true, nome: true, email: true, role: true, status: true },
  }));

  if (!user) return null;

  const alreadySuspended = membership?.status === 'INATIVO';
  const correlationId = randomUUID();
  await prisma.$transaction(async (tx) => {
    // Legacy users can predate UsuarioConta; create the tenant-scoped membership
    // in a suspended state so the same authorized PATCH can reactivate it later.
    await tx.usuarioConta.upsert({
      where: { usuarioId_contaId: { usuarioId: user.id, contaId: input.contaId } },
      update: { status: 'INATIVO' },
      create: {
        usuarioId: user.id,
        contaId: input.contaId,
        role: membership?.role ?? user.role,
        status: 'INATIVO',
      },
    });
    await tx.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorId,
        action: 'USER_TENANT_ACCESS_SUSPENDED',
        entityType: 'UsuarioConta',
        entityId: `${user.id}:${input.contaId}`,
        correlationId,
        metadata: {
          suspendedAt: new Date().toISOString(),
          userId: user.id,
          suspendedUserEmail: user.email,
          suspendedUserName: user.nome,
          suspendedUserRole: membership?.role ?? user.role,
          reason: input.reason?.trim() || null,
        },
      },
    });
  });

  return { id: user.id, hard: false, alreadyRemoved: alreadySuspended };
}
