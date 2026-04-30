import { z } from 'zod';

export const ProfessorCreateSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  bio: z.string().optional(),
});

export const ProfessorUpdateSchema = ProfessorCreateSchema.partial().extend({
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

export const ProfessorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).default(20).optional(),
  search: z.string().optional(),
});

export type ProfessorCreateInput = z.infer<typeof ProfessorCreateSchema>;
export type ProfessorUpdateInput = z.infer<typeof ProfessorUpdateSchema>;
export type ProfessorQueryInput = z.infer<typeof ProfessorQuerySchema>;