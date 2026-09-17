import { prisma } from '@/prisma/client';

export async function listActiveConsentimentoTemplates(contaId: string) {
  return prisma.contratoConsentimentoTemplate.findMany({
    where: {
      ativo: true,
      OR: [
        { contaId: null, origem: 'SISTEMA', slug: 'uso-imagem', grupoSlug: null },
        { contaId },
      ],
    },
    orderBy: [{ origem: 'asc' }, { nome: 'asc' }, { versao: 'desc' }],
    select: {
      id: true,
      slug: true,
      nome: true,
      finalidade: true,
      titulo: true,
      texto: true,
      variaveis: true,
      grupoSlug: true,
      grupoNome: true,
      grupoDescricao: true,
      introducao: true,
      encerramento: true,
      ordem: true,
      versao: true,
      origem: true,
    },
  });
}
