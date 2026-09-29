import { prisma } from '@/lib/prisma';
import { requestPlatformSubscriptionCancellation } from '@/src/server/platform-billing/plan-change-actions';

export async function isContaOwner(input: { contaId: string; userId: string }) {
  const conta = await prisma.conta.findUnique({
    where: { id: input.contaId },
    select: { ownerUserId: true },
  });
  return conta?.ownerUserId === input.userId;
}

export async function requestContaPlanCancellation(input: {
  contaId: string;
  actorUserId: string;
  idempotencyKey: string;
}) {
  return requestPlatformSubscriptionCancellation({ prisma, ...input });
}
