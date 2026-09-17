import { prisma } from '@alusa/database';

export async function getLocalAvailableBalance(contaId: string, db: typeof prisma = prisma) {
  const result = await db.cobranca.aggregate({
    where: {
      matricula: { aluno: { contaId } },
      liquidacaoStatus: 'DISPONIVEL',
      asaasStatus: { not: 'RECEIVED_IN_CASH' },
    },
    _sum: { asaasNetValue: true },
  });

  return result._sum.asaasNetValue?.toNumber() ?? 0;
}
