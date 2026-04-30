import { z } from 'zod';

export const listSubscriptionsQueryDTOSchema = z.object({
  /** Página (1-indexed), default 1 */
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10) || 1) : 1)),
  /** Itens por página, default 10, max 100 */
  pageSize: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, v ? parseInt(v, 10) || 10 : 10))),
  /** Filtro por status */
  status: z
    .enum(['REQUESTED', 'ACTIVE', 'INACTIVE', 'EXPIRED', 'DELETED', 'FAILED'])
    .optional(),
});

export type ListSubscriptionsQueryDTO = z.infer<typeof listSubscriptionsQueryDTOSchema>;

export type ListSubscriptionsQueryParsed = {
  page: number;
  pageSize: number;
  status?: string;
};
