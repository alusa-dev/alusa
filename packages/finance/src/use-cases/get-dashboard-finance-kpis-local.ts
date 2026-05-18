import { getEndOfCurrentMonth } from '../dtos/unified-billing';
import { financeSummaryReadModelService } from '../read-model/finance-summary-read-model.service';
import { getOperationalChargesSummary } from './list-operational-charges';

type DashboardFinanceKpiSource = 'charge_read_model' | 'cobranca' | 'operational_queue';
type DashboardFinanceKpiScope = 'unified' | 'academic_only' | 'operational_queue';

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

function buildWindow(now: Date) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = getEndOfCurrentMonth(now);
  return { startOfMonth, endOfMonth };
}

export async function getDashboardFinanceKpisLocal(
  input: GetDashboardFinanceKpisLocalInput,
): Promise<DashboardFinanceKpisLocalSnapshot> {
  const now = input.now ?? new Date();
  const { startOfMonth, endOfMonth } = buildWindow(now);
  const calculadoEm = now.toISOString();

  const summary = await getOperationalChargesSummary({ contaId: input.contaId, now });

  if (
    process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true' &&
    process.env.FIN_SUMMARY_SHADOW_COMPARE === 'true'
  ) {
    void financeSummaryReadModelService
      .getFinanceSummaryReadModel({
        contaId: input.contaId,
        window: { start: startOfMonth, end: endOfMonth },
        now,
      })
      .then((readModel) => {
        if (!readModel) return;
        if (
          Math.abs(summary.valorBruto - readModel.pendingAmountCurrentWindow) > 0.01 ||
          summary.total !== readModel.pendingCountCurrentWindow
        ) {
          console.warn('[finance][summary-read-model][shadow]', {
            contaId: input.contaId,
            readModelTotal: readModel.pendingCountCurrentWindow,
            operationalTotal: summary.total,
            readModelAmount: readModel.pendingAmountCurrentWindow,
            operationalAmount: summary.valorBruto,
          });
        }
      })
      .catch((error) => {
        console.warn('[finance][summary-read-model][shadow] compare failed', {
          contaId: input.contaId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  return {
    aguardandoPagamentoProximos30Dias: {
      valorBruto: summary.valorBruto,
      quantidadeDeCobrancas: summary.total,
      janela: {
        inicio: startOfMonth.toISOString(),
        fim: endOfMonth.toISOString(),
      },
      origemDados: 'operational_queue',
      escopo: 'operational_queue',
      calculadoEm,
      projectedAt: null,
    },
  };
}
