import { prisma } from '@/lib/prisma';

export function getTransactionReceiptSource(input: { contaId: string; lancamentoId: string }) {
  return prisma.lancamento.findFirst({
    where: { id: input.lancamentoId, contaId: input.contaId },
    select: { anexoUrl: true, externalRef: true },
  });
}
