import { prisma } from '@/lib/prisma';

export async function findCustomerByDocument(input: {
  contaId: string;
  document: string;
  uiRequestId?: string | null;
}) {
  const currentSale = input.uiRequestId
    ? await prisma.sale.findFirst({
        where: { contaId: input.contaId, uiRequestId: input.uiRequestId, customerType: 'AVULSO' },
        select: { responsavelId: true },
      })
    : null;

  const [aluno, responsavel] = await Promise.all([
    prisma.aluno.findFirst({
      where: { contaId: input.contaId, cpf: input.document },
      select: { id: true, nome: true },
    }),
    prisma.responsavel.findFirst({
      where: {
        contaId: input.contaId,
        cpf: input.document,
        ...(currentSale?.responsavelId ? { id: { not: currentSale.responsavelId } } : {}),
      },
      select: { id: true, nome: true },
    }),
  ]);

  return responsavel
    ? { type: 'RESPONSAVEL' as const, id: responsavel.id, name: responsavel.nome }
    : aluno
      ? { type: 'ALUNO' as const, id: aluno.id, name: aluno.nome }
      : null;
}
