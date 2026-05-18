import { cachedDashboardBlockWithTenant, requireDashboardBlockContaId, toNumber } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlockWithTenant(auth.contaId, 'summary-cards', async (tx) => {
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
      tx.aluno.count({ where: alunoFilter }),
      tx.aluno.count({ where: { ...alunoFilter, matriculas: { some: { status: 'ATIVA' } } } }),
      tx.turma.count({ where: { contaId, status: 'ATIVO' } }),
      tx.matricula.count({ where: matriculaFilter }),
      tx.matricula.count({ where: { ...matriculaFilter, status: 'ATIVA' } }),
      tx.cobranca.count({ where: { ...cobrancaFilter, status: 'PENDENTE' } }),
      tx.cobranca.count({ where: { ...cobrancaFilter, status: 'PENDENTE', vencimento: { lt: now } } }),
      tx.pagamento.aggregate({
        where: {
          status: { in: ['CONFIRMADO', 'PAGO'] },
          dataPagamento: { gte: startOfMonth, lte: endOfMonth },
          cobranca: cobrancaFilter,
        },
        _sum: { valorPago: true },
      }),
      tx.pagamento.aggregate({
        where: { status: { in: ['CONFIRMADO', 'PAGO'] }, cobranca: cobrancaFilter },
        _sum: { valorPago: true },
      }),
      tx.cobranca.count({ where: cobrancaFilter }),
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
