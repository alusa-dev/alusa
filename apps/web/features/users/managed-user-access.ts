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

/** Permanently removes one tenant membership while preserving the global identity and history. */
export async function removeManagedUserAccess(input: {
  userId: string;
  contaId: string;
  actorId: string;
  reason?: string | null;
}) {
  const correlationId = randomUUID();
  const staleMembership = Symbol('stale-membership');
  let removed: boolean;
  try {
    removed = await prisma.$transaction(async (tx) => {
    const membership = await tx.usuarioConta.findUnique({
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
    if (!membership) return false;

    // Preserve institutional records and history while removing identity links.
    // Collaborators use a composite Restrict FK to this membership.
    await tx.colaborador.updateMany({
      where: { usuarioId: input.userId, contaId: input.contaId },
      data: { usuarioId: null, temAcesso: false },
    });
    const linkedResponsibles = await tx.responsavel.findMany({
      where: { usuarioId: input.userId, contaId: input.contaId },
      select: { id: true },
    });
    await tx.responsavel.updateMany({
      where: { usuarioId: input.userId, contaId: input.contaId },
      data: { usuarioId: null },
    });
    const result = await tx.usuarioConta.deleteMany({
      where: {
        usuarioId: input.userId,
        contaId: input.contaId,
        role: membership.role,
        status: membership.status,
      },
    });
    if (result.count === 0) throw staleMembership;
    await tx.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorId,
        action: 'USER_TENANT_ACCESS_DELETED',
        entityType: 'UsuarioConta',
        entityId: `${membership.usuarioId}:${membership.contaId}`,
        correlationId,
        metadata: {
          deletedAt: new Date().toISOString(),
          userId: membership.usuario.id,
          userEmail: membership.usuario.email,
          userName: membership.usuario.nome,
          userRole: membership.role,
          userStatus: membership.status,
          actorId: input.actorId,
          contaId: input.contaId,
          reason: input.reason?.trim() || null,
          unlinkedResponsavelIds: linkedResponsibles.map(({ id }) => id),
          unlinkedResponsavelCount: linkedResponsibles.length,
        },
      },
    });
    return true;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error === staleMembership) return null;
    throw error;
  }

  return removed ? { id: input.userId, hard: true } : null;
}
