import prisma from '@/lib/prisma';

export async function listActiveAccountsForUser(userId: string) {
  return prisma.usuarioConta.findMany({
    where: {
      usuarioId: userId,
      status: 'ATIVO',
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: {
      contaId: true,
      role: true,
      conta: { select: { nome: true } },
    },
    orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'asc' }],
  });
}
