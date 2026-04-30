import { z } from 'zod';

/**
 * PayerDTO — Representa o pagador resolvido para fins financeiros
 * ADR: Service Único de Resolução de Pagador
 * 
 * Invariantes:
 * - Aluno menor de idade NUNCA é pagador direto
 * - Responsável financeiro é obrigatório para menores
 * - Este DTO é o resultado da resolução, não a entrada
 */
export const payerTypeSchema = z.enum(['ALUNO', 'RESPONSAVEL']);
export type PayerType = z.infer<typeof payerTypeSchema>;

export const payerDTOSchema = z.object({
  type: payerTypeSchema,
  id: z.string().min(1, 'ID do pagador é obrigatório'),
  asaasCustomerId: z.string().optional().nullable(),
  resolvedAt: z.coerce.date().default(() => new Date()),
});

export type PayerDTO = z.infer<typeof payerDTOSchema>;

/**
 * Input para resolução de pagador
 */
export const resolvePayerInputSchema = z.object({
  alunoId: z.string().min(1, 'ID do aluno é obrigatório'),
  alunoDataNasc: z.coerce.date(),
  responsavelFinanceiroId: z.string().optional().nullable(),
});

export type ResolvePayerInputDTO = z.infer<typeof resolvePayerInputSchema>;

/**
 * Resultado da resolução de pagador
 */
export const resolvePayerResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    payer: payerDTOSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.enum(['RESPONSAVEL_OBRIGATORIO_MENOR', 'ALUNO_SEM_ID', 'ALUNO_NAO_ENCONTRADO']),
    message: z.string().optional(),
  }),
]);

export type ResolvePayerResultDTO = z.infer<typeof resolvePayerResultSchema>;

/**
 * Resposta completa do serviço de resolução (com contexto adicional)
 */
export const payerResolvedSchema = z.object({
  payerType: payerTypeSchema,
  payerId: z.string(),
  asaasCustomerId: z.string().nullable(),
  resolvedAt: z.coerce.date(),
  isMenor: z.boolean(),
  needsResponsavel: z.boolean(),
});

export type PayerResolvedDTO = z.infer<typeof payerResolvedSchema>;
