import prisma from '@/lib/prisma';

export async function findPendingInviteForAcceptance(
  token: string,
  select: { email?: boolean; role?: boolean; status?: boolean; expiresAt?: boolean } = {
    email: true,
    role: true,
    status: true,
    expiresAt: true,
  },
) {
  return prisma.invite.findUnique({ where: { token }, select });
}
