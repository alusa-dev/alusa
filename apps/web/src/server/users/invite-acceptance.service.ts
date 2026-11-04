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
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { ...select, contaId: true, invitedById: true },
  });
  if (!invite || invite.status !== 'PENDING' || !invite.contaId) return null;
  const inviterMembership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: invite.invitedById,
      contaId: invite.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true },
  });
  return inviterMembership ? invite : null;
}

export async function findInviteForAcceptance(token: string) {
  return prisma.invite.findUnique({
    where: { token },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, contaId: true, invitedById: true, acceptedByUserId: true },
  });
}

export async function findExistingUserForInvite(email: string) {
  return prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, status: true, emailVerifiedAt: true, senhaHash: true },
  });
}

export async function findUserMembershipForInvite(usuarioId: string, contaId: string) {
  return prisma.usuarioConta.findUnique({
    where: { usuarioId_contaId: { usuarioId, contaId } },
    select: { status: true },
  });
}
