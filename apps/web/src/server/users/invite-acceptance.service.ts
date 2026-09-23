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
