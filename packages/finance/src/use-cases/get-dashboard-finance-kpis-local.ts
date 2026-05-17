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

  if (process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
    try {
      const summary = await financeSummaryReadModelService.getFinanceSummaryReadModel({
        contaId: input.contaId,
        window: { start: startOfMonth, end: endOfMonth },
        now,
      });

      if (summary) {
        if (process.env.FIN_SUMMARY_SHADOW_COMPARE === 'true') {
          void getOperationalChargesSummary({ contaId: input.contaId, now })
            .then((legacy) => {
              if (
                Math.abs(legacy.valorBruto - summary.pendingAmountCurrentWindow) > 0.01 ||
                legacy.total !== summary.pendingCountCurrentWindow
              ) {
                console.warn('[finance][summary-read-model][shadow]', {
                  contaId: input.contaId,
                  readModelTotal: summary.pendingCountCurrentWindow,
                  legacyTotal: legacy.total,
                  readModelAmount: summary.pendingAmountCurrentWindow,
                  legacyAmount: legacy.valorBruto,
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
            valorBruto: summary.pendingAmountCurrentWindow,
            quantidadeDeCobrancas: summary.pendingCountCurrentWindow,
            janela: {
              inicio: startOfMonth.toISOString(),
              fim: endOfMonth.toISOString(),
            },
            origemDados: 'charge_read_model',
            escopo: 'unified',
            calculadoEm,
            projectedAt: summary.projectedAt.toISOString(),
          },
        };
      }
    } catch (error) {
      console.warn('[finance][summary-read-model] fallback to operational summary', {
        contaId: input.contaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = await getOperationalChargesSummary({ contaId: input.contaId, now });

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
