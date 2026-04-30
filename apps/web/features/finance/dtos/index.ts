import { z } from 'zod';

const nullableStringDTOSchema = z.string().nullable();
const isoDateStringDTOSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida');

export const financeInstallmentAggregatedQueryDTOSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

export type FinanceInstallmentAggregatedQueryDTO = z.infer<
  typeof financeInstallmentAggregatedQueryDTOSchema
>;

export const financeInstallmentAggregatedItemDTOSchema = z
  .object({
    id: z.string(),
    studentName: z.string(),
    payerName: z.string(),
    totalValue: z.number(),
    installmentCount: z.number().int().nonnegative(),
    installmentsPaid: z.number().int().nonnegative(),
    statusConsolidado: z.enum(['EM_DIA', 'ATRASADO', 'QUITADO', 'CANCELADO']),
    proximoVencimento: nullableStringDTOSchema.default(null),
    matriculaId: nullableStringDTOSchema.default(null),
    contratoId: nullableStringDTOSchema.default(null),
    createdAt: isoDateStringDTOSchema,
  })
  .passthrough();

export type FinanceInstallmentAggregatedItemDTO = z.infer<
  typeof financeInstallmentAggregatedItemDTOSchema
>;

export const financeInstallmentAggregatedResultDTOSchema = z.object({
  data: z.array(financeInstallmentAggregatedItemDTOSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type FinanceInstallmentAggregatedResultDTO = z.infer<
  typeof financeInstallmentAggregatedResultDTOSchema
>;

export const financeSubscriptionEnrichedQueryDTOSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

export type FinanceSubscriptionEnrichedQueryDTO = z.infer<
  typeof financeSubscriptionEnrichedQueryDTOSchema
>;

export const financeSubscriptionEnrichedItemDTOSchema = z
  .object({
    id: z.string(),
    asaasSubscriptionId: nullableStringDTOSchema.default(null),
    clienteNome: z.string(),
    alunoNome: z.string(),
    alunoId: z.string(),
    valor: z.number(),
    cycle: z.string(),
    cycleLabel: z.string(),
    billingType: z.string(),
    description: nullableStringDTOSchema.default(null),
    nextDueDate: nullableStringDTOSchema.default(null),
    status: z.string(),
    statusLabel: z.string(),
    matriculaId: z.string(),
    createdAt: isoDateStringDTOSchema,
    tipo: z.enum(['PLANO', 'COMBO', 'AVULSA']).optional(),
  })
  .passthrough();

export type FinanceSubscriptionEnrichedItemDTO = z.infer<
  typeof financeSubscriptionEnrichedItemDTOSchema
>;

export const financeSubscriptionEnrichedResultDTOSchema = z.object({
  data: z.array(financeSubscriptionEnrichedItemDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type FinanceSubscriptionEnrichedResultDTO = z.infer<
  typeof financeSubscriptionEnrichedResultDTOSchema
>;

export const financePayerSearchQueryDTOSchema = z.object({
  q: z.string().trim().min(2),
});

export type FinancePayerSearchQueryDTO = z.infer<typeof financePayerSearchQueryDTOSchema>;

export const financePayerResolvedDTOSchema = z.object({
  type: z.enum(['aluno', 'responsavel']),
  id: z.string(),
  name: z.string(),
  hasAsaasCustomerId: z.boolean(),
});

export type FinancePayerResolvedDTO = z.infer<typeof financePayerResolvedDTOSchema>;

export const financePayerCandidateDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['aluno', 'responsavel']),
  cpf: z.string().optional(),
  isMinor: z.boolean(),
  hasResponsible: z.boolean(),
  responsibleId: nullableStringDTOSchema.default(null),
  responsibleName: nullableStringDTOSchema.default(null),
  payerResolved: financePayerResolvedDTOSchema,
  financialStatus: z.enum(['OK', 'INCOMPLETE']),
});

export type FinancePayerCandidateDTO = z.infer<typeof financePayerCandidateDTOSchema>;

export const financePayerSearchResultDTOSchema = z.object({
  results: z.array(financePayerCandidateDTOSchema),
});

export type FinancePayerSearchResultDTO = z.infer<typeof financePayerSearchResultDTOSchema>;
