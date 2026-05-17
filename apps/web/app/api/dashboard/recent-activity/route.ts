import { prisma } from '@/lib/prisma';
import { cachedDashboardBlock, publicImageUrl, requireDashboardBlockContaId } from '../_blocks';

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
          matricula: { select: { aluno: { select: { nome: true } } } },
        },
      }),
      prisma.aluno.findMany({
        take: 3,
        where: { contaId: auth.contaId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, nome: true, foto: true },
      }),
    ]);

    return {
      success: true,
      data: {
        ultimasCobrancas: ultimasCobrancasData.map((cobranca) => ({
          id: cobranca.id,
          aluno: cobranca.matricula.aluno.nome,
          valor: Number(cobranca.valor),
          vencimento: cobranca.vencimento.toISOString(),
          status: cobranca.status,
        })),
        alunosRecentes: alunosRecentesData.map((aluno) => ({
          id: aluno.id,
          nome: aluno.nome,
          foto: publicImageUrl(aluno.foto),
          tipo: 'Novo cadastro',
        })),
      },
    };
  });
}
