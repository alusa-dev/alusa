import { z } from 'zod';

export const listInstallmentPlansQueryDTOSchema = z.object({
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
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']).optional(),
});

export type ListInstallmentPlansQueryDTO = z.infer<typeof listInstallmentPlansQueryDTOSchema>;

export type ListInstallmentPlansQueryParsed = {
  page: number;
  pageSize: number;
  status?: string;
};
