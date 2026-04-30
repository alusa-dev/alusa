import { z } from 'zod';
import { professorCreateSchema, professorUpdateSchema } from '../schemas/professor';

export const ProfessorCreateSchema = professorCreateSchema;
export const ProfessorUpdateSchema = professorUpdateSchema;

// Query schema legado (mantido para compatibilidade em serviços internos)
export const ProfessorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).default(20).optional(),
  search: z.string().optional(),
});

export type ProfessorCreateInput = z.infer<typeof ProfessorCreateSchema>;
export type ProfessorUpdateInput = z.infer<typeof ProfessorUpdateSchema>;
export type ProfessorQueryInput = z.infer<typeof ProfessorQuerySchema>;
