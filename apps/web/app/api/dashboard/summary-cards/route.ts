import { prisma } from '@/lib/prisma';
import { cachedDashboardBlock, requireDashboardBlockContaId, toNumber } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlock(auth.contaId, 'summary-cards', async () => {
    const contaId = auth.contaId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const alunoFilter = { contaId };
    const matriculaFilter = { aluno: { contaId } };
    const cobrancaFilter = { matricula: { aluno: { contaId } } };

    const [
      totalAlunos,
      alunosAtivos,
      turmasAtivas,
      totalMatriculas,
      matriculasAtivas,
      cobrancasPendentes,
      cobrancasVencidas,
      receitaMesAggregate,
      receitaTotalAggregate,
      totalCobrancas,
    ] = await Promise.all([
      prisma.aluno.count({ where: alunoFilter }),
      prisma.aluno.count({ where: { ...alunoFilter, matriculas: { some: { status: 'ATIVA' } } } }),
      prisma.turma.count({ where: { contaId, status: 'ATIVO' } }),
      prisma.matricula.count({ where: matriculaFilter }),
      prisma.matricula.count({ where: { ...matriculaFilter, status: 'ATIVA' } }),
      prisma.cobranca.count({ where: { ...cobrancaFilter, status: 'PENDENTE' } }),
      prisma.cobranca.count({ where: { ...cobrancaFilter, status: 'PENDENTE', vencimento: { lt: now } } }),
      prisma.pagamento.aggregate({
        where: {
          status: { in: ['CONFIRMADO', 'PAGO'] },
          dataPagamento: { gte: startOfMonth, lte: endOfMonth },
          cobranca: cobrancaFilter,
        },
        _sum: { valorPago: true },
      }),
      prisma.pagamento.aggregate({
        where: { status: { in: ['CONFIRMADO', 'PAGO'] }, cobranca: cobrancaFilter },
        _sum: { valorPago: true },
      }),
      prisma.cobranca.count({ where: cobrancaFilter }),
    ]);

    return {
      success: true,
      data: {
        totalAlunos,
        alunosAtivos,
        turmasAtivas,
        totalMatriculas,
        matriculasAtivas,
        cobrancasPendentes,
        cobrancasVencidas,
        receitaMes: toNumber(receitaMesAggregate._sum.valorPago),
        receitaTotal: toNumber(receitaTotalAggregate._sum.valorPago),
        taxaInadimplencia: totalCobrancas > 0 ? (cobrancasVencidas / totalCobrancas) * 100 : 0,
      },
    };
  });
}
