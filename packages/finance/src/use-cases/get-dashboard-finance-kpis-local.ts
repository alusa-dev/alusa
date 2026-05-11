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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfNext30Days = new Date(startOfToday);
  endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
  endOfNext30Days.setHours(23, 59, 59, 999);
  return { startOfToday, endOfNext30Days };
}

export async function getDashboardFinanceKpisLocal(
  input: GetDashboardFinanceKpisLocalInput,
): Promise<DashboardFinanceKpisLocalSnapshot> {
  const now = input.now ?? new Date();
  const { startOfToday, endOfNext30Days } = buildWindow(now);
  const calculadoEm = now.toISOString();

  if (isReadModelEnabled()) {
    const readModelAggregate = await prisma.chargeReadModel.aggregate({
      where: {
        contaId: input.contaId,
        status: 'PENDING',
        dueDate: {
          gte: startOfToday,
          lte: endOfNext30Days,
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
          inicio: startOfToday.toISOString(),
          fim: endOfNext30Days.toISOString(),
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
      status: { in: ['PENDENTE', 'A_VENCER'] },
      vencimento: {
        gte: startOfToday,
        lte: endOfNext30Days,
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
        inicio: startOfToday.toISOString(),
        fim: endOfNext30Days.toISOString(),
      },
      origemDados: 'cobranca',
      escopo: 'academic_only',
      calculadoEm,
      projectedAt: null,
    },
  };
}