import { prisma } from '@/lib/prisma';

export async function getPublicEventMapOrderCustomerContext(publicSlug: string, orderId: string) {
  return prisma.eventMapOrder.findFirst({
    where: {
      id: orderId,
      map: {
        is: {
          publicSlug,
          status: 'PUBLISHED',
          publicEnabled: true,
        },
      },
    },
    select: { contaId: true, asaasCustomerId: true },
  });
}
