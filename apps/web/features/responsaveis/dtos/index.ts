import { z } from 'zod';

import { responsavelSchema } from '@/lib/validations/aluno-responsavel.schema';

export const listResponsaveisQueryDTOSchema = z.object({
  q: z.string().trim().max(120).optional(),
});

export type ListResponsaveisQueryDTO = z.infer<typeof listResponsaveisQueryDTOSchema>;

export const responsavelSummaryDTOSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  cpfMasked: z.string().nullable().optional(),
  emailMasked: z.string().nullable().optional(),
  phoneMasked: z.string().nullable().optional(),
  cpf: z.string().min(1),
  email: z.string(),
  telefone: z.string(),
  financeiro: z.boolean(),
  alunosCount: z.number().int().nonnegative().optional().default(0),
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

export const updateResponsavelInputDTOSchema = responsavelSchema
  .omit({ id: true })
  .partial()
  .extend({
    endereco: z
      .object({
        cep: z.string().optional(),
        logradouro: z.string().optional(),
        numero: z.string().optional(),
        complemento: z.string().optional(),
        bairro: z.string().optional(),
        cidade: z.string().optional(),
        uf: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export type UpdateResponsavelInputDTO = z.infer<typeof updateResponsavelInputDTOSchema>;

export const responsavelDetailDTOSchema = responsavelSummaryDTOSchema.extend({
  asaasCustomerId: z.string().nullable(),
  usuarioId: z.string().nullable(),
  endereco: z.object({
    cep: z.string().nullable(),
    logradouro: z.string().nullable(),
    numero: z.string().nullable(),
    complemento: z.string().nullable(),
    bairro: z.string().nullable(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
  }),
  metrics: z.object({
    alunos: z.number().int().nonnegative(),
    matriculasFinanceiras: z.number().int().nonnegative(),
    vendas: z.number().int().nonnegative(),
  }),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type ResponsavelDetailDTO = z.infer<typeof responsavelDetailDTOSchema>;

export const responsavelOverviewSummaryDTOSchema = z.object({
  familyEnrollments: z.number().int().nonnegative(),
  familyReenrollments: z.number().int().nonnegative(),
  openCharges: z.number().int().nonnegative(),
  overdueCharges: z.number().int().nonnegative(),
  totalOpenValue: z.number().nonnegative(),
});

export const responsavelFamilyAggregateDTOSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['MATRICULA', 'REMATRICULA']),
  status: z.string().min(1),
  totalAlunos: z.number().int().nonnegative(),
  valorMensalidadeTotal: z.number().nonnegative(),
  valorTaxaMatriculaTotal: z.number().nonnegative(),
  standaloneSubscriptionId: z.string().nullable(),
  standaloneEnrollmentChargeId: z.string().nullable(),
  createdAt: z.string().datetime().or(z.string().min(1)),
});

export const responsavelFamilyChargeDTOSchema = z.object({
  id: z.string().min(1),
  origin: z.enum(['STANDALONE', 'FAMILY', 'EVENT']).optional(),
  description: z.string().nullable(),
  status: z.string().min(1),
  value: z.number().nonnegative(),
  dueDate: z.string().nullable(),
  billingType: z.string().nullable().optional(),
  invoiceUrl: z.string().nullable(),
  familyGroupId: z.string().nullable(),
  standaloneSubscriptionId: z.string().nullable().optional(),
  standaloneInstallmentPlanId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

export const responsavelSubscriptionDTOSchema = z.object({
  id: z.string().min(1),
  source: z.literal('AVULSA'),
  status: z.string().min(1),
  asaasSubscriptionId: z.string().nullable(),
  externalReference: z.string().nullable(),
  cycle: z.string().min(1),
  billingType: z.string().min(1),
  value: z.number().nonnegative(),
  nextDueDate: z.string().nullable(),
  description: z.string().nullable(),
  familyGroupId: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const responsavelInstallmentPlanDTOSchema = z.object({
  id: z.string().min(1),
  source: z.literal('AVULSO'),
  status: z.string().min(1),
  asaasInstallmentId: z.string().nullable(),
  externalReference: z.string().nullable(),
  installmentCount: z.number().int().nonnegative(),
  billingType: z.string().min(1),
  value: z.number().nonnegative(),
  firstDueDate: z.string().nullable(),
  familyGroupId: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const responsavelRematriculaCandidateDTOSchema = z.object({
  matriculaId: z.string().min(1),
  alunoId: z.string().min(1),
  alunoNome: z.string().min(1),
  dataFimContrato: z.string().min(1),
  planoNome: z.string().nullable(),
  comboNome: z.string().nullable(),
  turmaNome: z.string().nullable(),
  actionStatus: z.string().min(1),
  blockReason: z.string().nullable(),
  message: z.string().min(1),
  podeRenovar: z.boolean(),
});

export const responsavelOverviewDTOSchema = z.object({
  summary: responsavelOverviewSummaryDTOSchema,
  families: z.array(responsavelFamilyAggregateDTOSchema),
  reenrollments: z.array(responsavelFamilyAggregateDTOSchema),
  charges: z.array(responsavelFamilyChargeDTOSchema),
  subscriptions: z.array(responsavelSubscriptionDTOSchema).default([]),
  installmentPlans: z.array(responsavelInstallmentPlanDTOSchema).default([]),
  rematriculaCandidates: z.array(responsavelRematriculaCandidateDTOSchema),
});

export type ResponsavelOverviewDTO = z.infer<typeof responsavelOverviewDTOSchema>;

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
