import type { ExtratoQueryInput, ExtratoResponse, LedgerEntry } from '../dtos';

type GetExtratoParams = ExtratoQueryInput;

interface FetchExtratoOptions {
  signal?: AbortSignal;
}

const DEV_LEDGER_FIXTURE_ENTRIES: LedgerEntry[] = [
  {
    id: 'fixture_ft_1',
    date: '2026-03-09',
    description: 'Recebimento manual em dinheiro',
    type: 'RECEITA',
    status: 'CONFIRMADO',
    grossValue: 150,
    fee: 0,
    netValue: 150,
    balanceAfter: 150,
    chargeName: 'Mensalidade Março',
    customerName: 'Bryan Alencar',
    paymentId: 'pay_fixture_cash_1',
    transferId: null,
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: { asaasType: 'PAYMENT_RECEIVED', rawCategory: 'PAYMENT_RECEIVED' },
  },
  {
    id: 'fixture_ft_2',
    date: '2026-03-09',
    description: 'Taxa da cobrança',
    type: 'TAXA',
    status: 'CONFIRMADO',
    grossValue: -3.47,
    fee: 3.47,
    netValue: 0,
    balanceAfter: 146.53,
    chargeName: 'Mensalidade Março',
    customerName: 'Bryan Alencar',
    paymentId: 'pay_fixture_cash_1',
    transferId: null,
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: { asaasType: 'PAYMENT_FEE', rawCategory: 'PAYMENT_FEE' },
  },
  {
    id: 'fixture_ft_3',
    date: '2026-03-08',
    description: 'Estorno de recebimento',
    type: 'ESTORNO',
    status: 'CANCELADO',
    grossValue: -50,
    fee: 0,
    netValue: -50,
    balanceAfter: 96.53,
    chargeName: 'Cobrança avulsa',
    customerName: 'Cliente Teste',
    paymentId: 'pay_fixture_refund_1',
    transferId: null,
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: { asaasType: 'REVERSAL', rawCategory: 'PAYMENT_REFUND' },
  },
  {
    id: 'fixture_ft_4',
    date: '2026-03-08',
    description: 'Transferência para conta externa',
    type: 'TRANSFERENCIA',
    status: 'CONFIRMADO',
    grossValue: -25,
    fee: 0,
    netValue: -25,
    balanceAfter: 71.53,
    chargeName: undefined,
    customerName: undefined,
    paymentId: null,
    transferId: 'tr_fixture_1',
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: {
      asaasType: 'TRANSFER',
      rawCategory: 'TRANSFER_SENT',
      transferRequestId: 'transfer_req_fixture_1',
    },
  },
  {
    id: 'fixture_ft_5',
    date: '2026-03-07',
    description: 'Antecipação de recebíveis',
    type: 'ANTECIPACAO',
    status: 'CONFIRMADO',
    grossValue: 200,
    fee: 0,
    netValue: 200,
    balanceAfter: 271.53,
    chargeName: undefined,
    customerName: undefined,
    paymentId: null,
    transferId: null,
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: { asaasType: 'RECEIVABLE_ANTICIPATION_CREDIT', rawCategory: 'ANTICIPATION' },
  },
  {
    id: 'fixture_ft_6',
    date: '2026-03-07',
    description: 'Ajuste manual do saldo',
    type: 'AJUSTE',
    status: 'CONFIRMADO',
    grossValue: 10,
    fee: 0,
    netValue: 10,
    balanceAfter: 281.53,
    chargeName: undefined,
    customerName: undefined,
    paymentId: null,
    transferId: null,
    invoiceId: null,
    billId: null,
    splitId: null,
    paymentDunningId: null,
    creditBureauReportId: null,
    source: 'ASAAS',
    metadata: { asaasType: 'CREDIT', rawCategory: 'OTHER' },
  },
];

function getDebugFixtureParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('debugFixture');
}

function shouldUseDevFixture(): boolean {
  return process.env.NODE_ENV === 'development' && getDebugFixtureParam() === 'sample-ledger';
}

function applyFixtureFilters(entries: LedgerEntry[], params: GetExtratoParams): LedgerEntry[] {
  let result = [...entries];

  if (params.startDate) {
    result = result.filter((entry) => entry.date >= params.startDate!);
  }

  if (params.endDate) {
    result = result.filter((entry) => entry.date <= params.endDate!);
  }

  if (params.type?.length) {
    const typeSet = new Set(params.type);
    result = result.filter((entry) => typeSet.has(entry.type));
  }

  if (params.status?.length) {
    const statusSet = new Set(params.status);
    result = result.filter((entry) => statusSet.has(entry.status));
  }

  if (params.search) {
    const term = params.search.toLowerCase();
    result = result.filter((entry) =>
      entry.description.toLowerCase().includes(term)
      || entry.chargeName?.toLowerCase().includes(term)
      || entry.customerName?.toLowerCase().includes(term)
      || entry.externalReference?.toLowerCase().includes(term)
      || entry.paymentId?.toLowerCase().includes(term)
      || entry.transferId?.toLowerCase().includes(term)
      || false,
    );
  }

  const direction = params.direction === 'asc' ? 1 : -1;
  const sort = params.sort ?? 'date';

  result.sort((a, b) => {
    switch (sort) {
      case 'grossValue':
        return (a.grossValue - b.grossValue) * direction;
      case 'type':
        return a.type.localeCompare(b.type) * direction;
      case 'date':
      default:
        return a.date.localeCompare(b.date) * direction;
    }
  });

  return result;
}

function buildFixtureResponse(params: GetExtratoParams): ExtratoResponse {
  const filtered = applyFixtureFilters(DEV_LEDGER_FIXTURE_ENTRIES, params);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const startIndex = (page - 1) * pageSize;
  const transactions = filtered.slice(startIndex, startIndex + pageSize);
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const summary = filtered.reduce(
    (acc, entry) => {
      acc.liquido += entry.netValue;
      if (entry.type === 'RECEITA') acc.receitas += entry.netValue;
      if (entry.type === 'ESTORNO') acc.estornos += Math.abs(entry.netValue);
      if (entry.type !== 'RECEITA' && entry.type !== 'ESTORNO' && entry.netValue < 0) {
        acc.despesas += Math.abs(entry.netValue);
      }
      return acc;
    },
    { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
  );

  return {
    summary,
    filters: {
      startDate: params.startDate,
      endDate: params.endDate,
      type: params.type,
      status: params.status,
      search: params.search,
      sort: params.sort,
      direction: params.direction,
    },
    transactions,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
    },
    sync: {
      provider: 'ASAAS',
      fetchedAt: new Date().toISOString(),
      officialTotalCount: filtered.length,
      fetchedCount: filtered.length,
      truncated: false,
      maxWindowPages: 50,
    },
  };
}

export async function fetchExtrato(
  params: GetExtratoParams,
  options?: FetchExtratoOptions,
): Promise<ExtratoResponse> {
  if (shouldUseDevFixture()) {
    return buildFixtureResponse(params);
  }

  const searchParams = new URLSearchParams();

  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.type?.length) searchParams.set('type', params.type.join(','));
  if (params.status?.length) searchParams.set('status', params.status.join(','));
  if (params.search) searchParams.set('search', params.search);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.direction) searchParams.set('direction', params.direction);

  const res = await fetch(`/api/financeiro/extrato?${searchParams.toString()}`, {
    cache: 'no-store',
    signal: options?.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : 'Falha ao carregar extrato';
    throw new Error(message);
  }

  return res.json() as Promise<ExtratoResponse>;
}
