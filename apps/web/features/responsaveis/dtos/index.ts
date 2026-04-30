import { z } from 'zod';

import { responsavelSchema } from '@/lib/validations/aluno-responsavel.schema';

export const listResponsaveisQueryDTOSchema = z.object({
  q: z.string().trim().max(120).optional(),
});

export type ListResponsaveisQueryDTO = z.infer<typeof listResponsaveisQueryDTOSchema>;

export const responsavelSummaryDTOSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  cpf: z.string().min(1),
  email: z.string(),
  telefone: z.string(),
  financeiro: z.boolean(),
});

export type ResponsavelSummaryDTO = z.infer<typeof responsavelSummaryDTOSchema>;

export const listResponsaveisResultDTOSchema = z.object({
  items: z.array(responsavelSummaryDTOSchema),
});

export type ListResponsaveisResultDTO = z.infer<typeof listResponsaveisResultDTOSchema>;

export const createResponsavelInputDTOSchema = responsavelSchema.omit({ id: true });

export type CreateResponsavelInputDTO = z.infer<typeof createResponsavelInputDTOSchema>;

export const createResponsavelResultDTOSchema = responsavelSummaryDTOSchema;

export type CreateResponsavelResultDTO = z.infer<typeof createResponsavelResultDTOSchema>;

export const linkAlunoResponsavelInputDTOSchema = z.object({
  responsavelId: z.string().trim().min(1),
  tipoVinculo: z.string().trim().min(1).default('PRINCIPAL'),
});

export type LinkAlunoResponsavelInputDTO = z.infer<typeof linkAlunoResponsavelInputDTOSchema>;

export const linkAlunoResponsavelResultDTOSchema = z.object({
  created: z.boolean(),
  vinculo: z.object({
    id: z.string().min(1),
    alunoId: z.string().min(1),
    responsavelId: z.string().min(1),
    tipoVinculo: z.string().min(1),
  }),
});

export type LinkAlunoResponsavelResultDTO = z.infer<typeof linkAlunoResponsavelResultDTOSchema>;

export const anonymizeResponsavelInputDTOSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});

export type AnonymizeResponsavelInputDTO = z.infer<typeof anonymizeResponsavelInputDTOSchema>;

export const anonymizeResponsavelResultDTOSchema = z.object({
  success: z.literal(true),
  responsavel: z.object({ id: z.string().min(1) }).passthrough(),
});

export type AnonymizeResponsavelResultDTO = z.infer<typeof anonymizeResponsavelResultDTOSchema>;
