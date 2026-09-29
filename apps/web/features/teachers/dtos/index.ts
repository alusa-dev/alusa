import { z } from 'zod';
import { ProfessorCreateSchema, ProfessorUpdateSchema } from '@alusa/lib/client';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);

export const createProfessorInputDTOSchema = ProfessorCreateSchema;
export type CreateProfessorInputDTO = z.input<typeof createProfessorInputDTOSchema>;

export const updateProfessorInputDTOSchema = ProfessorUpdateSchema;
export type UpdateProfessorInputDTO = z.input<typeof updateProfessorInputDTOSchema>;

export const professorDTOSchema = z
  .object({
    id: z.string(),
    contaId: z.string().optional(),
    nome: z.string(),
    email: z.string().email().nullable().optional(),
    telefoneCel: z.string().nullable().optional(),
    status: z.string(),
    createdAt: dateLikeDTOSchema.optional(),
    updatedAt: dateLikeDTOSchema.optional(),
  })
  .passthrough();

export type ProfessorDTO = z.infer<typeof professorDTOSchema>;

export const listProfessoresQueryDTOSchema = z.object({
  contaId: z.string().trim().optional(),
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(20),
});

export type ListProfessoresQueryDTO = z.infer<typeof listProfessoresQueryDTOSchema>;

export const listProfessoresResultDTOSchema = z.object({
  data: z.array(professorDTOSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export type ListProfessoresResultDTO = z.infer<typeof listProfessoresResultDTOSchema>;

export const professorMutationResultDTOSchema = z.object({
  data: professorDTOSchema,
});

export type ProfessorMutationResultDTO = z.infer<typeof professorMutationResultDTOSchema>;
