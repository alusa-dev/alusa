import { prisma } from '@/lib/prisma';

export async function listAvailableStudentsForResponsible(contaId: string) {
  return prisma.aluno.findMany({
    where: {
      contaId,
      status: 'ATIVO',
      usuarioId: null,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      dataNasc: true,
    },
    orderBy: { nome: 'asc' },
  });
}
