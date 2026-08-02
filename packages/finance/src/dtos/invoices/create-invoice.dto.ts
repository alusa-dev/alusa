import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD');

export const createInvoiceDTOSchema = z
  .object({
    chargeId: z.string().min(1, 'chargeId é obrigatório'),

    serviceDescription: z.string().min(1).max(2000).optional(),
    observations: z.string().max(2000).optional(),
    deductions: z.coerce.number().nonnegative().optional(),
    effectiveDate: isoDateSchema.optional(),
  })
  .strict();

export type CreateInvoiceDTO = z.infer<typeof createInvoiceDTOSchema>;
