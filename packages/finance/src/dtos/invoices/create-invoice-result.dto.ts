import { z } from 'zod';

export const invoiceStatusSchema = z.enum([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
]);

export const createInvoiceResultDTOSchema = z
  .object({
    id: z.string(),
    chargeId: z.string(),
    externalReference: z.string(),
    asaasInvoiceId: z.string().nullable(),
    status: invoiceStatusSchema,
    statusUpdatedAt: z.string(),
    pdfUrl: z.string().nullable(),
    xmlUrl: z.string().nullable(),
    number: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

export type InvoiceStatusDTO = z.infer<typeof invoiceStatusSchema>;
export type CreateInvoiceResultDTO = z.infer<typeof createInvoiceResultDTOSchema>;
