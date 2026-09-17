import { prisma } from '@alusa/database';

export async function getKycCommercialInfo(contaId: string) {
  return prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: {
      commercialInfoStatus: true,
      commercialInfoScheduledDate: true,
    },
  });
}
