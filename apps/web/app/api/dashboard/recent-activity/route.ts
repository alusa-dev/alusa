import { cachedDashboardBlockWithTenant, resolveAlunoPublicAvatar, requireDashboardBlockContaId } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlockWithTenant(auth.contaId, 'recent-activity', async (tx) => {
    const [ultimasCobrancasData, alunosRecentesData] = await Promise.all([
      tx.cobranca.findMany({
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
