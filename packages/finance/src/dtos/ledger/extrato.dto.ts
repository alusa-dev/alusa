import { z } from 'zod';

// ─── LedgerEntryType (6 tipos semânticos de UI) ───
export const ledgerEntryTypeSchema = z.enum([
  'RECEITA',
  'TAXA',
  'ESTORNO',
  'TRANSFERENCIA',
  'ANTECIPACAO',
  'AJUSTE',
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeSchema>;

// ─── LedgerEntryStatus ───
export const ledgerEntryStatusSchema = z.enum([
  'CONFIRMADO',
  'CANCELADO',
]);
export type LedgerEntryStatus = z.infer<typeof ledgerEntryStatusSchema>;

// ─── LedgerEntry (contrato externo da página) ───
export const ledgerEntrySchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  date: z.string(),
  description: z.string(),
  type: ledgerEntryTypeSchema,
  status: ledgerEntryStatusSchema,
  grossValue: z.number(),
  fee: z.number(),
  netValue: z.number(),
  balanceAfter: z.number().optional(),
  externalReference: z.string().nullable().optional(),
  chargeName: z.string().optional(),
  customerName: z.string().optional(),
  paymentId: z.string().nullable().optional(),
  splitId: z.string().nullable().optional(),
  transferId: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  billId: z.string().nullable().optional(),
  paymentDunningId: z.string().nullable().optional(),
  creditBureauReportId: z.string().nullable().optional(),
  source: z.literal('ASAAS'),
  metadata: z.object({
    chargeId: z.string().optional(),
    contractId: z.string().optional(),
    subscriptionId: z.string().optional(),
    studentId: z.string().optional(),
    asaasType: z.string().optional(),
    rawCategory: z.string().optional(),
    externalReference: z.string().optional(),
    externalReferenceType: z.string().optional(),
    invoiceRecordId: z.string().optional(),
    transferRequestId: z.string().optional(),
    transferExternalReference: z.string().optional(),
    transferRecipientDocumentMasked: z.string().optional(),
    transferRecipientBank: z.string().optional(),
  }).optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const extratoSyncSchema = z.object({
  provider: z.literal('ASAAS'),
  fetchedAt: z.string().datetime(),
  officialTotalCount: z.number().int().nonnegative(),
  fetchedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  maxWindowPages: z.number().int().positive(),
});
export type ExtratoSync = z.infer<typeof extratoSyncSchema>;

// ─── ExtratoSummary ───
export const extratoSummarySchema = z.object({
  receitas: z.number(),
  despesas: z.number(),
  estornos: z.number(),
  liquido: z.number(),
});
export type ExtratoSummary = z.infer<typeof extratoSummarySchema>;

// ─── ExtratoFilters ───
export const extratoFiltersSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.array(ledgerEntryTypeSchema).optional(),
  status: z.array(ledgerEntryStatusSchema).optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});
export type ExtratoFilters = z.infer<typeof extratoFiltersSchema>;

// ─── ExtratoPagination ───
export const extratoPaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
});
export type ExtratoPagination = z.infer<typeof extratoPaginationSchema>;

// ─── ExtratoResponse (contrato estável do BFF) ───
export const extratoResponseSchema = z.object({
  summary: extratoSummarySchema,
  filters: extratoFiltersSchema,
  transactions: z.array(ledgerEntrySchema),
  pagination: extratoPaginationSchema,
  sync: extratoSyncSchema,
});
export type ExtratoResponse = z.infer<typeof extratoResponseSchema>;

// ─── ExtratoQueryInput (query params da rota) ───
export const extratoQueryInputSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(ledgerEntryTypeSchema).optional(),
  ),
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(ledgerEntryStatusSchema).optional(),
  ),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['date', 'grossValue', 'type']).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type ExtratoQueryInput = z.infer<typeof extratoQueryInputSchema>;
