import { prisma } from '@alusa/database';

type DashboardFinanceKpiSource = 'charge_read_model' | 'cobranca';
type DashboardFinanceKpiScope = 'unified' | 'academic_only';

export type DashboardPendingPaymentsKpi = {
  valorBruto: number;
  quantidadeDeCobrancas: number;
  janela: {
    inicio: string;
    fim: string;
  };
  origemDados: DashboardFinanceKpiSource;
  escopo: DashboardFinanceKpiScope;
  calculadoEm: string;
  projectedAt: string | null;
};

export type DashboardFinanceKpisLocalSnapshot = {
  aguardandoPagamentoProximos30Dias: DashboardPendingPaymentsKpi;
};

export type GetDashboardFinanceKpisLocalInput = {
  contaId: string;
  now?: Date;
};

function isReadModelEnabled(): boolean {
  return process.env.FIN_READMODEL_ENABLED === 'true';
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function buildWindow(now: Date) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startOfMonth, endOfMonth };
}

export async function getDashboardFinanceKpisLocal(
  input: GetDashboardFinanceKpisLocalInput,
): Promise<DashboardFinanceKpisLocalSnapshot> {
  const now = input.now ?? new Date();
  const { startOfMonth, endOfMonth } = buildWindow(now);
  const calculadoEm = now.toISOString();

  if (isReadModelEnabled()) {
    const readModelAggregate = await prisma.chargeReadModel.aggregate({
      where: {
        contaId: input.contaId,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        OR: [
          {
            origin: 'ACADEMIC',
            sourceKind: 'COBRANCA',
          },
          {
            origin: 'STANDALONE',
            sourceKind: 'CHARGE',
          },
        ],
      },
      _sum: { value: true },
      _count: { _all: true },
      _max: { projectedAt: true },
    });

    return {
      aguardandoPagamentoProximos30Dias: {
        valorBruto: roundCurrency(Number(readModelAggregate._sum.value ?? 0)),
        quantidadeDeCobrancas: readModelAggregate._count._all,
        janela: {
          inicio: startOfMonth.toISOString(),
          fim: endOfMonth.toISOString(),
        },
        origemDados: 'charge_read_model',
        escopo: 'unified',
        calculadoEm,
        projectedAt: readModelAggregate._max.projectedAt?.toISOString() ?? null,
      },
    };
  }

  const cobrancas = await prisma.cobranca.findMany({
    where: {
      matricula: { aluno: { contaId: input.contaId } },
      status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      vencimento: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
    select: {
      valor: true,
      valorFinal: true,
    },
  });

  const valorBruto = cobrancas.reduce((sum, cobranca) => {
    return sum + Number(cobranca.valorFinal ?? cobranca.valor ?? 0);
  }, 0);

  return {
    aguardandoPagamentoProximos30Dias: {
      valorBruto: roundCurrency(valorBruto),
      quantidadeDeCobrancas: cobrancas.length,
      janela: {
        inicio: startOfMonth.toISOString(),
        fim: endOfMonth.toISOString(),
      },
      origemDados: 'cobranca',
      escopo: 'academic_only',
      calculadoEm,
      projectedAt: null,
    },
  };
}