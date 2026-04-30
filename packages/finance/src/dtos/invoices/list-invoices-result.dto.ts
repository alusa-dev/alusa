import { z } from 'zod';

import { invoiceStatusSchema } from './create-invoice-result.dto';

export const invoiceListItemDTOSchema = z
  .object({
    id: z.string(),
    chargeId: z.string(),
    externalReference: z.string(),
    asaasInvoiceId: z.string().nullable(),
    status: invoiceStatusSchema,
    statusUpdatedAt: z.string(),
    number: z.string().nullable(),
    pdfUrl: z.string().nullable(),
    xmlUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

export const listInvoicesResultDTOSchema = z
  .object({
    items: z.array(invoiceListItemDTOSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  })
  .strict();

export type InvoiceListItemDTO = z.infer<typeof invoiceListItemDTOSchema>;
export type ListInvoicesResultDTO = z.infer<typeof listInvoicesResultDTOSchema>;
