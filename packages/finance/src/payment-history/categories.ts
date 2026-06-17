export const PAYMENT_HISTORY_CATEGORIES = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'PARCELAMENTO',
  'ASSINATURA',
  'LOJA',
  'EVENTOS',
  'OUTROS',
] as const;

export type PaymentHistoryCategory = (typeof PAYMENT_HISTORY_CATEGORIES)[number];

export const PRIMARY_PAYMENT_HISTORY_CATEGORIES = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'PARCELAMENTO',
  'ASSINATURA',
  'LOJA',
  'EVENTOS',
] as const satisfies readonly PaymentHistoryCategory[];

export const PAYMENT_HISTORY_CATEGORY_LABELS: Record<PaymentHistoryCategory, string> = {
  TAXA_MATRICULA: 'Taxa de Matrícula',
  MENSALIDADE: 'Mensalidades',
  PARCELAMENTO: 'Parcelamentos',
  ASSINATURA: 'Assinaturas',
  LOJA: 'Loja',
  EVENTOS: 'Eventos',
  OUTROS: 'Outros',
};

export const PAYMENT_HISTORY_CATEGORY_FILTER_OPTIONS = PRIMARY_PAYMENT_HISTORY_CATEGORIES.map(
  (value) => ({
    value,
    label: PAYMENT_HISTORY_CATEGORY_LABELS[value],
  }),
);
