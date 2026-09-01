import { cachedDashboardBlockWithTenant, resolveAlunoPublicAvatar, requireDashboardBlockContaId } from '../_blocks';
import { loadRecentDashboardCharges } from '@/lib/dashboard/load-recent-charges';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlockWithTenant(auth.contaId, 'recent-activity', async (tx) => {
    const [ultimasCobrancas, alunosRecentesData] = await Promise.all([
      loadRecentDashboardCharges(tx, auth.contaId),
      tx.aluno.findMany({
        take: 4,
        where: { contaId: auth.contaId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, nome: true, foto: true },
      }),
    ]);

    return {
      success: true,
      data: {
        ultimasCobrancas,
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
