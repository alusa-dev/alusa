import { prisma } from '@/lib/prisma';

export async function resolveResponsavelRouteId(inputId: string, contaId: string) {
  const id = inputId.trim();
  if (!id) return null;

  const responsavel = await prisma.responsavel.findFirst({
    where: { id, contaId },
    select: { id: true },
  });

  if (responsavel) return responsavel.id;

  const vinculo = await prisma.alunoResponsavel.findFirst({
    where: {
      id,
      OR: [{ aluno: { contaId } }, { responsavel: { contaId } }],
    },
    select: { responsavelId: true },
  });

  return vinculo?.responsavelId ?? null;
}
