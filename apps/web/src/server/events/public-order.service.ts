import { prisma } from '@/lib/prisma';

export async function getPublicEventMapOrderCustomerContext(orderId: string) {
  return prisma.eventMapOrder.findUnique({
    where: { id: orderId },
    select: { contaId: true, asaasCustomerId: true },
  });
}
