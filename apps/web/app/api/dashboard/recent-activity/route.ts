import { prisma } from '@/lib/prisma';
import { cachedDashboardBlock, resolveAlunoPublicAvatar, requireDashboardBlockContaId } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlock(auth.contaId, 'recent-activity', async () => {
    const [ultimasCobrancasData, alunosRecentesData] = await Promise.all([
      prisma.cobranca.findMany({
        take: 5,
        where: { matricula: { aluno: { contaId: auth.contaId } } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          valor: true,
          vencimento: true,
          status: true,
          matricula: { select: { aluno: { select: { id: true, nome: true, foto: true } } } },
        },
      }),
      prisma.aluno.findMany({
        take: 8,
        where: { contaId: auth.contaId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, nome: true, foto: true },
      }),
    ]);

    return {
      success: true,
      data: {
        ultimasCobrancas: ultimasCobrancasData.map((cobranca) => {
          const aluno = cobranca.matricula.aluno;
          const avatarUrl = resolveAlunoPublicAvatar(aluno);
          return {
            id: cobranca.id,
            alunoId: aluno.id,
            aluno: aluno.nome,
            alunoAvatarUrl: avatarUrl,
            valor: Number(cobranca.valor),
            vencimento: cobranca.vencimento.toISOString(),
            status: cobranca.status,
          };
        }),
        alunosRecentes: alunosRecentesData.map((aluno) => {
          const avatarUrl = resolveAlunoPublicAvatar(aluno);
          return {
            id: aluno.id,
            nome: aluno.nome,
            foto: avatarUrl,
            avatarUrl,
            tipo: 'Novo cadastro',
          };
        }),
      },
    };
  });
}
