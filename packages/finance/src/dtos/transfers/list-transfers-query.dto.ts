import { z } from 'zod';

/**
 * DTO de query para listagem de transferências
 * Campos vêm como string da querystring e são transformados
 */

export const listTransfersQueryDTOSchema = z.object({
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
  status: z.enum(['REQUESTED', 'PENDING', 'BLOCKED', 'PROCESSING', 'DONE', 'CANCELED', 'FAILED']).optional(),
  /** Busca textual */
  search: z.string().trim().optional(),
  /** Operação */
  operation: z.enum(['PIX', 'TED']).optional(),
  /** Data inicial (ISO date) */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Data final (ISO date) */
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Direção de ordenação */
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type ListTransfersQueryDTO = z.infer<typeof listTransfersQueryDTOSchema>;

/** Tipo após transformação (page e pageSize já são numbers) */
export type ListTransfersQueryParsed = {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  operation?: 'PIX' | 'TED';
  from?: string;
  to?: string;
  direction: 'asc' | 'desc';
};
