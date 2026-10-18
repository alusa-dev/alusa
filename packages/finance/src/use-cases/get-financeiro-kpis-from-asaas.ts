import type { AsaasPayment, PaymentStatus } from '@alusa/asaas';

import { listPayments } from './asaas-ops';
import { assertCompleteAsaasPage } from './asaas-pagination';

export type FinanceiroKpiSnapshot = {
  valorBruto: number;
  valorLiquido: number;
  quantidadeDeCobrancas: number;
  quantidadeDeClientes: number;
};

export type FinanceiroKpisSnapshot = {
  recebidas: FinanceiroKpiSnapshot;
  recebidasEmDinheiro: FinanceiroKpiSnapshot;
  confirmadas: FinanceiroKpiSnapshot;
  aguardandoPagamento: FinanceiroKpiSnapshot;
  vencidas: FinanceiroKpiSnapshot;
  receitaDoMes: FinanceiroKpiSnapshot & {
    periodo: {
      inicio: string;
      fim: string;
    };
  };
  resumo: {
    totalReceitaReal: number;
    totalAReceber: number;
    totalInadimplente: number;
    taxaInadimplencia: number;
  };
};

export type GetFinanceiroKpisFromAsaasInput = {
  contaId: string;
  mesAtual: Date;
  proximoMes: Date;
  startOfToday: Date;
  endOfNext30Days: Date;
};

export type GetFinanceiroKpisFromAsaasOutput = {
  data: FinanceiroKpisSnapshot;
  paymentIdsForReconcile: string[];
};

const MAX_ASAAS_LIMIT = 100;
const MAX_WINDOW_PAGES = 20;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

async function fetchAllPayments(params: {
  contaId: string;
  status: PaymentStatus;
  filters?: Record<string, string | number | boolean | undefined>;
}): Promise<AsaasPayment[]> {
  const all: AsaasPayment[] = [];
  const seenPaymentIds = new Set<string>();
  let offset = 0;
  let pages = 0;
  let hasMore = true;
  let expectedTotalCount: number | undefined;

  while (pages < MAX_WINDOW_PAGES) {
    let response: Awaited<ReturnType<typeof listPayments>>;
    try {
      response = await listPayments(
        {
          status: params.status,
          limit: MAX_ASAAS_LIMIT,
          offset,
          ...params.filters,
        },
        { contaId: params.contaId },
      );
    } catch (error) {
      throw new Error(`ASAAS_PAYMENT_LOOKUP_INCOMPLETE:${params.status}:page${pages}`, { cause: error });
    }

    if (
      !response ||
      !Array.isArray(response.data) ||
      typeof response.hasMore !== 'boolean' ||
      response.offset !== offset ||
      response.limit !== MAX_ASAAS_LIMIT ||
      response.data.some((payment) => {
        const id = typeof payment?.id === 'string' ? payment.id.trim() : '';
        if (!id || seenPaymentIds.has(id)) return true;
        seenPaymentIds.add(id);
        return false;
      })
    ) {
      throw new Error(`ASAAS_PAYMENT_LOOKUP_INCOMPLETE:${params.status}:invalid_page${pages}`);
    }
    try {
      expectedTotalCount = assertCompleteAsaasPage(response, offset, MAX_ASAAS_LIMIT, expectedTotalCount);
    } catch (error) {
      throw new Error(`ASAAS_PAYMENT_LOOKUP_INCOMPLETE:${params.status}:total_count${pages}`, { cause: error });
    }

    all.push(...response.data);
    pages += 1;
    hasMore = response.hasMore;
    if (!hasMore) break;
    if (response.data.length === 0) {
      throw new Error(`ASAAS_PAYMENT_LOOKUP_INCOMPLETE:${params.status}:empty_page_with_more${pages - 1}`);
    }
    offset += MAX_ASAAS_LIMIT;
  }

  if (hasMore) {
    throw new Error(`ASAAS_PAYMENT_LOOKUP_INCOMPLETE:${params.status}:max_pages_reached:${MAX_WINDOW_PAGES}`);
  }

  return all;
}

function toKpi(payments: AsaasPayment[]): FinanceiroKpiSnapshot {
  const customers = new Set(payments.map((payment) => payment.customer).filter(Boolean));
  const valorBruto = payments.reduce((acc, payment) => acc + Number(payment.value ?? 0), 0);
  const valorLiquido = payments.reduce((acc, payment) => acc + Number(payment.netValue ?? payment.value ?? 0), 0);

  return {
    valorBruto: roundCurrency(valorBruto),
    valorLiquido: roundCurrency(valorLiquido),
    quantidadeDeCobrancas: payments.length,
    quantidadeDeClientes: customers.size,
  };
}

export async function getFinanceiroKpisFromAsaas(
  input: GetFinanceiroKpisFromAsaasInput,
): Promise<GetFinanceiroKpisFromAsaasOutput> {
  const mesInicio = formatDate(input.mesAtual);
  const mesFim = formatDate(new Date(input.proximoMes.getTime() - 1));
  const today = formatDate(input.startOfToday);
  const next30Days = formatDate(input.endOfNext30Days);

  const [received, receivedInCash, confirmed, pending, overdue] = await Promise.all([
    fetchAllPayments({
      contaId: input.contaId,
      status: 'RECEIVED',
      filters: {
        'paymentDate[ge]': mesInicio,
        'paymentDate[le]': mesFim,
      },
    }),
    fetchAllPayments({
      contaId: input.contaId,
      status: 'RECEIVED_IN_CASH',
      filters: {
        'paymentDate[ge]': mesInicio,
        'paymentDate[le]': mesFim,
      },
    }),
    fetchAllPayments({
      contaId: input.contaId,
      status: 'CONFIRMED',
    }),
    fetchAllPayments({
      contaId: input.contaId,
      status: 'PENDING',
      filters: {
        'dueDate[ge]': today,
        'dueDate[le]': next30Days,
      },
    }),
    fetchAllPayments({
      contaId: input.contaId,
      status: 'OVERDUE',
    }),
  ]);

  const paymentStatusById = new Map<string, string>();
  for (const [status, payments] of [
    ['RECEIVED', received],
    ['RECEIVED_IN_CASH', receivedInCash],
    ['CONFIRMED', confirmed],
    ['PENDING', pending],
    ['OVERDUE', overdue],
  ] as const) {
    for (const payment of payments) {
      const previousStatus = paymentStatusById.get(payment.id);
      if (previousStatus) {
        throw new Error(
          `ASAAS_PAYMENT_LOOKUP_INCONSISTENT:CROSS_STATUS_DUPLICATE:${payment.id}:${previousStatus}:${status}`,
        );
      }
      paymentStatusById.set(payment.id, status);
    }
  }

  const recebidas = toKpi(received);
  const recebidasEmDinheiro = toKpi(receivedInCash);
  const confirmadas = toKpi(confirmed);
  const aguardandoPagamento = toKpi(pending);
  const vencidas = toKpi(overdue);
  const receitaDoMes = toKpi([...received, ...receivedInCash]);

  const totalEmAberto = aguardandoPagamento.quantidadeDeCobrancas + vencidas.quantidadeDeCobrancas;
  const taxaInadimplencia = totalEmAberto > 0
    ? (vencidas.quantidadeDeCobrancas / totalEmAberto) * 100
    : 0;

  const paymentIdsForReconcile = [...new Set([
    ...received,
    ...receivedInCash,
    ...confirmed,
    ...pending,
    ...overdue,
  ].map((payment) => payment.id))];

  return {
    data: {
      recebidas,
      recebidasEmDinheiro,
      confirmadas,
      aguardandoPagamento,
      vencidas,
      receitaDoMes: {
        ...receitaDoMes,
        periodo: {
          inicio: input.mesAtual.toISOString(),
          fim: input.proximoMes.toISOString(),
        },
      },
      resumo: {
        totalReceitaReal: roundCurrency(receitaDoMes.valorLiquido),
        totalAReceber: roundCurrency(aguardandoPagamento.valorBruto + confirmadas.valorBruto),
        totalInadimplente: roundCurrency(vencidas.valorBruto),
        taxaInadimplencia: roundCurrency(taxaInadimplencia),
      },
    },
    paymentIdsForReconcile,
  };
}
