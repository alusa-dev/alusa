import { z } from 'zod';

export const ledgerCategorySchema = z.enum([
  'PAYMENT_RECEIVED',
  'PAYMENT_FEE',
  'PAYMENT_REFUND',
  'TRANSFER_SENT',
  'TRANSFER_RECEIVED',
  'TRANSFER_FEE',
  'BILL_PAYMENT',
  'PIX_DEBIT',
  'PIX_CREDIT',
  'PIX_FEE',
  'INTERNAL_TRANSFER',
  'PROMOTIONAL_CREDIT',
  'CUSTODY',
  'CHARGEBACK',
  'ANTICIPATION',
  'CARD',
  'INVOICE_FEE',
  'DUNNING_FEE',
  'NOTIFICATION_FEE',
  'JUDICIAL',
  'COMMISSION',
  'PLAN_FEE',
  'MOBILE_RECHARGE',
  'ASAAS_MONEY',
  'CONTRACTUAL_EFFECT',
  'OTHER',
]);
export type LedgerCategory = z.infer<typeof ledgerCategorySchema>;

export const ledgerSignSchema = z.enum(['CREDIT', 'DEBIT']);
export type LedgerSign = z.infer<typeof ledgerSignSchema>;

export const ledgerEntryDTOSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  asaasType: z.string(),
  category: ledgerCategorySchema,
  sign: ledgerSignSchema,
  value: z.number(),
  balance: z.number(),
  externalReference: z.string().nullable(),
  paymentId: z.string().nullable(),
  splitId: z.string().nullable(),
  transferId: z.string().nullable(),
  anticipationId: z.string().nullable(),
  billId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  paymentDunningId: z.string().nullable(),
  creditBureauReportId: z.string().nullable(),
});

export type LedgerEntryDTO = z.infer<typeof ledgerEntryDTOSchema>;

export const listLedgerEntriesResultDTOSchema = z.object({
  data: z.array(ledgerEntryDTOSchema),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  summaryScope: z.literal('CURRENT_PAGE'),
  summary: z.object({
    credits: z.number(),
    debits: z.number(),
    fees: z.number(),
    net: z.number(),
  }),
});

export type ListLedgerEntriesResultDTO = z.infer<typeof listLedgerEntriesResultDTOSchema>;

export const listLedgerEntriesQueryDTOSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  finishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type ListLedgerEntriesQueryDTO = z.infer<typeof listLedgerEntriesQueryDTOSchema>;
