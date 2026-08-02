import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function listStudentsLinkedToResponsible(
  db: PrismaLike,
  input: { contaId: string; responsavelId: string; alunoIds?: string[] },
) {
  return db.alunoResponsavel.findMany({
    where: {
      contaId: input.contaId,
      responsavelId: input.responsavelId,
      ...(input.alunoIds ? { alunoId: { in: input.alunoIds } } : {}),
      aluno: { contaId: input.contaId },
    },
    orderBy: { aluno: { nome: 'asc' } },
    select: {
      alunoId: true,
      aluno: {
        select: {
          id: true,
          nome: true,
          dataNasc: true,
          cpf: true,
          foto: true,
          status: true,
        },
      },
    },
  });
}

export async function findUnlinkedStudentIds(
  db: PrismaLike,
  input: { contaId: string; responsavelId: string; alunoIds: string[] },
) {
  const links = await listStudentsLinkedToResponsible(db, input);
  const linkedIds = new Set(links.map((link) => link.alunoId));
  return input.alunoIds.filter((alunoId) => !linkedIds.has(alunoId));
}
