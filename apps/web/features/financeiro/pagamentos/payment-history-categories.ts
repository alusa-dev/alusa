export const PAYMENT_HISTORY_CATEGORIES = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'PARCELAMENTO',
  'ASSINATURA',
  'LOJA',
  'OUTROS',
] as const;

export type PaymentHistoryCategory = (typeof PAYMENT_HISTORY_CATEGORIES)[number];

export const PRIMARY_PAYMENT_HISTORY_CATEGORIES = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'PARCELAMENTO',
  'ASSINATURA',
  'LOJA',
] as const satisfies readonly PaymentHistoryCategory[];

export const PAYMENT_HISTORY_CATEGORY_LABELS: Record<PaymentHistoryCategory, string> = {
  TAXA_MATRICULA: 'Taxa de Matrícula',
  MENSALIDADE: 'Mensalidades',
  PARCELAMENTO: 'Parcelamentos',
  ASSINATURA: 'Assinaturas',
  LOJA: 'Loja',
  OUTROS: 'Outros',
};

export const PAYMENT_HISTORY_CATEGORY_FILTER_OPTIONS = PRIMARY_PAYMENT_HISTORY_CATEGORIES.map(
  (value) => ({
    value,
    label: PAYMENT_HISTORY_CATEGORY_LABELS[value],
  }),
);

export type PaymentHistoryCategoryInput = {
  tipo?: string | null;
  chargeType?: string | null;
  origin?: string | null;
  sourceKind?: string | null;
};

export function normalizePaymentHistoryCategory(
  item: PaymentHistoryCategoryInput,
): PaymentHistoryCategory {
  const tipo = item.tipo?.toUpperCase() ?? null;
  const chargeType = item.chargeType?.toUpperCase() ?? null;
  const key = tipo ?? chargeType;

  if (key === 'TAXA_MATRICULA') return 'TAXA_MATRICULA';
  if (key === 'MENSALIDADE') return 'MENSALIDADE';
  if (key === 'PARCELADA' || key === 'INSTALLMENT') return 'PARCELAMENTO';
  if (key === 'RECORRENTE' || key === 'SUBSCRIPTION') return 'ASSINATURA';
  if (key === 'LOJA' || item.origin === 'LOJA' || item.sourceKind === 'sale') return 'LOJA';

  return 'OUTROS';
}

export function matchesPaymentHistoryCategoryFilter(
  item: PaymentHistoryCategoryInput,
  filter: string,
): boolean {
  if (filter === 'TODOS') return true;
  return normalizePaymentHistoryCategory(item) === filter;
}

export function resolvePaymentHistoryDetailHref(item: {
  sourceKind: string;
  sourceId: string;
  category: PaymentHistoryCategory;
}): string {
  if (item.sourceKind === 'sale') return `/vendas/${item.sourceId}`;
  return `/cobrancas/${item.sourceId}`;
}

export function buildCategorySummary<T extends { category: PaymentHistoryCategory; pagamento?: { valorPago: number } | null }>(
  items: T[],
) {
  const summary = Object.fromEntries(
    PAYMENT_HISTORY_CATEGORIES.map((category) => [category, { count: 0, totalPago: 0 }]),
  ) as Record<PaymentHistoryCategory, { count: number; totalPago: number }>;

  for (const item of items) {
    summary[item.category].count += 1;
    summary[item.category].totalPago += item.pagamento?.valorPago ?? 0;
  }

  return summary;
}
