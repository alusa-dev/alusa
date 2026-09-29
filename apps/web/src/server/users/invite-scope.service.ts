import prisma from '@/lib/prisma';

export async function findStudentsInContaForInvite(contaId: string, studentIds: string[]) {
  return prisma.aluno.findMany({
    where: { contaId, id: { in: studentIds } },
    select: { id: true },
  });
}
