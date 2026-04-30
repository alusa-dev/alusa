import { z } from 'zod';

export const listInvoicesQueryDTOSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    status: z.enum(['REQUESTED', 'ISSUED', 'CANCELING', 'CANCELED', 'ERROR']).optional(),
  })
  .strict();

export type ListInvoicesQueryDTO = z.input<typeof listInvoicesQueryDTOSchema>;
export type ListInvoicesQueryParsed = z.infer<typeof listInvoicesQueryDTOSchema>;
