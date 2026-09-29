import prisma from '@/lib/prisma';

export async function findPendingInviteForAcceptance(
  token: string,
  select: { email?: boolean; role?: boolean; status?: boolean; expiresAt?: boolean; contaId?: boolean } = {
    email: true,
    role: true,
    status: true,
    expiresAt: true,
    contaId: true,
  },
) {
  return prisma.invite.findUnique({ where: { token }, select });
}

export async function findExistingUserForInvite(email: string) {
  return prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, status: true, contaId: true },
  });
}

export async function findUserMembershipForInvite(usuarioId: string, contaId: string) {
  return prisma.usuarioConta.findUnique({
    where: { usuarioId_contaId: { usuarioId, contaId } },
    select: { status: true },
  });
}
