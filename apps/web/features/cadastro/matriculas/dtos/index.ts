import { z } from 'zod';

const dateStringDTOSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida');

const nullableDateStringDTOSchema = dateStringDTOSchema.nullable();
const nullableStringDTOSchema = z.string().nullable();
const numberLikeDTOSchema = z.union([z.number(), z.string()]);
const booleanLikeDTOSchema = z.union([z.boolean(), z.string()]);
const dateLikeDTOSchema = z.union([z.date(), z.string()]);

export const matriculaRouteParamsDTOSchema = z.object({
  id: z.string().min(1),
});
export type MatriculaRouteParamsDTO = z.infer<typeof matriculaRouteParamsDTOSchema>;

export const matriculaStatusDTOSchema = z.enum([
  'PENDENTE_TAXA',
  'AGUARDANDO_CONFIRMACAO',
  'ATIVA',
  'PAUSADA',
  'RECUSADA',
  'CANCELADA',
]);
export type MatriculaStatusDTO = z.infer<typeof matriculaStatusDTOSchema>;

export const matriculaStatusFilterDTOSchema = z.union([
  matriculaStatusDTOSchema,
  z.literal('CONCLUIDA'),
]);
export type MatriculaStatusFilterDTO = z.infer<typeof matriculaStatusFilterDTOSchema>;

export const matriculaStatusContratoDTOSchema = z.enum([
  'AGUARDANDO_ASSINATURA',
  'ATIVO',
  'EXPIRADO',
  'CANCELADO',
]);
export type MatriculaStatusContratoDTO = z.infer<typeof matriculaStatusContratoDTOSchema>;

export const matriculaStatusFinanceiroDTOSchema = z.enum([
  'PENDENTE_TAXA',
  'ADIMPLENTE',
  'INADIMPLENTE',
  'PENDENTE_FINANCEIRO',
]);
export type MatriculaStatusFinanceiroDTO = z.infer<typeof matriculaStatusFinanceiroDTOSchema>;

export const matriculaCobrancaStatusDTOSchema = z.enum([
  'PENDENTE',
  'A_VENCER',
  'PROCESSANDO',
  'PAGO',
  'ATRASADO',
  'CANCELADO',
  'ESTORNADO',
]);
export type MatriculaCobrancaStatusDTO = z.infer<typeof matriculaCobrancaStatusDTOSchema>;

export const matriculaFormaPagamentoDTOSchema = z.enum([
  'BOLETO',
  'PIX',
  'CARTAO',
  'CARTAO_CREDITO',
  'DINHEIRO',
  'INDEFINIDO',
]);
export type MatriculaFormaPagamentoDTO = z.infer<typeof matriculaFormaPagamentoDTOSchema>;

export const matriculaTaxaStatusDTOSchema = z.enum(['PENDENTE', 'PAGO', 'EXPIRADO', 'ISENTO']);
export type MatriculaTaxaStatusDTO = z.infer<typeof matriculaTaxaStatusDTOSchema>;

export const matriculaIntegrationStatusDTOSchema = z.enum([
  'PENDENTE_SINCRONISMO',
  'SINCRONIZADO',
  'DIVERGENTE',
]);
export type MatriculaIntegrationStatusDTO = z.infer<typeof matriculaIntegrationStatusDTOSchema>;

export const matriculaTipoCobrancaDTOSchema = z.enum([
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'EXTRA',
  'AVULSA',
  'PARCELADA',
  'RECORRENTE',
]);
export type MatriculaTipoCobrancaDTO = z.infer<typeof matriculaTipoCobrancaDTOSchema>;

export const matriculaBillingTypeDTOSchema = z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']);
export type MatriculaBillingTypeDTO = z.infer<typeof matriculaBillingTypeDTOSchema>;

export const matriculaAdjustmentTypeDTOSchema = z.enum(['FIXED', 'PERCENTAGE']);
export type MatriculaAdjustmentTypeDTO = z.infer<typeof matriculaAdjustmentTypeDTOSchema>;

export const listMatriculasQueryDTOSchema = z.object({
  contaId: z.string().trim().optional(),
  alunoId: z.string().trim().optional(),
  planoId: z.string().trim().optional(),
  turmaId: z.string().trim().optional(),
  comboId: z.string().trim().optional().nullable(),
  status: z.array(matriculaStatusFilterDTOSchema).default([]),
  excludeStatus: z.array(matriculaStatusFilterDTOSchema).default([]),
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(20),
});
export type ListMatriculasQueryDTO = z.infer<typeof listMatriculasQueryDTOSchema>;

export const createMatriculaInputDTOSchema = z.object({
  contaId: z.string().trim().optional(),
  alunoId: z.string().trim().min(1, 'Aluno é obrigatório'),
  planoId: z.string().trim().min(1).optional().nullable(),
  turmaId: z.string().trim().min(1).optional().nullable(),
  comboId: z.string().trim().min(1).optional().nullable(),
  responsavelFinanceiroId: z.string().trim().min(1).optional().nullable(),
  dataInicio: dateLikeDTOSchema.optional(),
  dataFimContrato: dateLikeDTOSchema,
  vencimento: dateLikeDTOSchema.optional().nullable(),
  vencimentoDia: numberLikeDTOSchema.optional(),
  taxaMatricula: numberLikeDTOSchema.optional(),
  taxaIsenta: booleanLikeDTOSchema.optional(),
  taxaJustificativa: z.string().trim().optional().nullable(),
  pagarTaxaAgora: booleanLikeDTOSchema.optional(),
  gerarCobrancaTaxa: booleanLikeDTOSchema.optional(),
  criarCobranca: booleanLikeDTOSchema.optional(),
  billingMode: z.enum(['INDIVIDUAL', 'SHARED_PLAN']).optional(),
  valorMensalidadeOverride: numberLikeDTOSchema.optional().nullable(),
  formaPagamento: z.string().trim().optional(),
  formaPagamentoTaxa: z.string().trim().optional(),
  jurosMensal: numberLikeDTOSchema.optional().nullable(),
  multaPercentual: numberLikeDTOSchema.optional().nullable(),
  descontoAntecipado: numberLikeDTOSchema.optional().nullable(),
  descontoTipo: matriculaAdjustmentTypeDTOSchema.optional(),
  prazoDesconto: numberLikeDTOSchema.optional().nullable(),
  descontoIds: z.array(z.string().trim().min(1)).optional().default([]),
  notificationChannels: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))
    .optional()
    .default([]),
  notificationChannelsConfigured: z.boolean().optional().default(false),
});
export type CreateMatriculaInputDTO = z.input<typeof createMatriculaInputDTOSchema>;

export const updateMatriculaInputDTOSchema = z
  .object({
    contaId: z.string().trim().optional().nullable(),
    status: matriculaStatusDTOSchema.optional(),
    dataInicio: dateStringDTOSchema.optional(),
    dataFimContrato: dateStringDTOSchema.optional(),
    vencimentoDia: z.number().int().min(1).max(28).optional(),
  })
  .refine((value) => value.status || value.dataInicio || value.dataFimContrato || value.vencimentoDia, {
    message: 'Informe pelo menos um campo para atualização.',
  });
export type UpdateMatriculaInputDTO = z.input<typeof updateMatriculaInputDTOSchema>;

export const editMatriculaInputDTOSchema = z.object({
  contaId: z.string().trim().optional().nullable(),
  turmaId: z.string().trim().optional().nullable(),
  comboId: z.string().trim().optional().nullable(),
  planoId: z.string().trim().optional().nullable(),
  motivo: z.string().trim().optional().nullable(),
});
export type EditMatriculaInputDTO = z.input<typeof editMatriculaInputDTOSchema>;

export const updateMatriculaStatusSyncInputDTOSchema = z.object({
  status: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']),
  motivo: z.string().trim().optional(),
});
export type UpdateMatriculaStatusSyncInputDTO = z.input<
  typeof updateMatriculaStatusSyncInputDTOSchema
>;

export const pausarMatriculaInputDTOSchema = z.object({
  motivoPausa: z.string().trim().min(1, 'Motivo é obrigatório'),
  dataInicioPausa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  dataRetornoPrevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  manterVaga: z.boolean(),
  cobrarDurantePausa: z.boolean(),
  observacao: z.string().trim().optional(),
});
export type PausarMatriculaInputDTO = z.infer<typeof pausarMatriculaInputDTOSchema>;

export const reativarMatriculaInputDTOSchema = z.object({
  dataRetornoEfetiva: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  nextDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data da próxima cobrança deve estar no formato YYYY-MM-DD'),
  observacao: z.string().trim().optional(),
});
export type ReativarMatriculaInputDTO = z.infer<typeof reativarMatriculaInputDTOSchema>;

export const updateMatriculaValueInputDTOSchema = z.object({
  contaId: z.string().trim().optional().nullable(),
  value: z.number().positive(),
  updatePendingPayments: z.boolean().optional().default(true),
});
export type UpdateMatriculaValueInputDTO = z.input<typeof updateMatriculaValueInputDTOSchema>;

export const updateMatriculaBillingTypeInputDTOSchema = z.object({
  contaId: z.string().trim().optional().nullable(),
  billingType: matriculaBillingTypeDTOSchema,
});
export type UpdateMatriculaBillingTypeInputDTO = z.input<
  typeof updateMatriculaBillingTypeInputDTOSchema
>;

export const matriculaAdjustmentDTOSchema = z.object({
  value: z.number(),
  type: matriculaAdjustmentTypeDTOSchema.optional(),
});
export type MatriculaAdjustmentDTO = z.input<typeof matriculaAdjustmentDTOSchema>;

export const matriculaDiscountDTOSchema = z.object({
  value: z.number(),
  type: matriculaAdjustmentTypeDTOSchema.optional(),
  dueDateLimitDays: z.number().int().nonnegative().optional(),
});
export type MatriculaDiscountDTO = z.input<typeof matriculaDiscountDTOSchema>;

export const updateMatriculaJurosMultaInputDTOSchema = z.object({
  contaId: z.string().trim().optional().nullable(),
  interest: matriculaAdjustmentDTOSchema.optional(),
  fine: matriculaAdjustmentDTOSchema.optional(),
  discount: matriculaDiscountDTOSchema.optional(),
});
export type UpdateMatriculaJurosMultaInputDTO = z.input<
  typeof updateMatriculaJurosMultaInputDTOSchema
>;

export const matriculaNotificationChannelsDTOSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  whatsapp: z.boolean(),
});
export type MatriculaNotificationChannelsDTO = z.infer<
  typeof matriculaNotificationChannelsDTOSchema
>;

export const matriculaNotificationWarningDTOSchema = z.object({
  notificationId: z.string(),
  event: z.string(),
  channel: z.enum(['email', 'sms', 'whatsapp']),
  code: z.string(),
  message: z.string(),
});
export type MatriculaNotificationWarningDTO = z.infer<typeof matriculaNotificationWarningDTOSchema>;

export const updateMatriculaNotificationChannelsInputDTOSchema = z.object({
  contaId: z.string().trim().optional().nullable(),
  channels: matriculaNotificationChannelsDTOSchema,
});
export type UpdateMatriculaNotificationChannelsInputDTO = z.input<
  typeof updateMatriculaNotificationChannelsInputDTOSchema
>;

export const matriculaNotificationChannelsResultDTOSchema = z.object({
  customerId: z.string(),
  channels: matriculaNotificationChannelsDTOSchema,
  notificationCount: z.number().int().nonnegative(),
  syncedAt: dateStringDTOSchema,
  message: z.string().optional(),
  warnings: z.array(matriculaNotificationWarningDTOSchema).default([]),
});
export type MatriculaNotificationChannelsResultDTO = z.infer<
  typeof matriculaNotificationChannelsResultDTOSchema
>;

export const matriculaAlunoResumoDTOSchema = z.object({
  id: z.string(),
  nome: nullableStringDTOSchema.default(null),
  cpf: nullableStringDTOSchema.default(null),
});
export type MatriculaAlunoResumoDTO = z.infer<typeof matriculaAlunoResumoDTOSchema>;

export const matriculaPlanoResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  valor: z.number(),
});
export type MatriculaPlanoResumoDTO = z.infer<typeof matriculaPlanoResumoDTOSchema>;

export const matriculaTurmaResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  diasSemana: z.array(z.string()).default([]),
  horaInicio: z.string(),
  horaFim: z.string(),
});
export type MatriculaTurmaResumoDTO = z.infer<typeof matriculaTurmaResumoDTOSchema>;

export const matriculaComboResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
});
export type MatriculaComboResumoDTO = z.infer<typeof matriculaComboResumoDTOSchema>;

export const matriculaResponsavelResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: nullableStringDTOSchema.default(null),
  telefone: nullableStringDTOSchema.default(null),
});
export type MatriculaResponsavelResumoDTO = z.infer<typeof matriculaResponsavelResumoDTOSchema>;

export const matriculaContratoResumoDTOSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDENTE', 'ASSINADO', 'EXPIRADO', 'CANCELADO']),
  tokenPublico: z.string(),
  createdAt: dateStringDTOSchema,
  tokenExpiraEm: nullableDateStringDTOSchema.default(null),
  template: z
    .object({
      nome: z.string(),
    })
    .optional(),
});
export type MatriculaContratoResumoDTO = z.infer<typeof matriculaContratoResumoDTOSchema>;

export const matriculaCobrancaDTOSchema = z.object({
  id: z.string(),
  valor: z.number(),
  status: matriculaCobrancaStatusDTOSchema,
  formaPagamento: matriculaFormaPagamentoDTOSchema,
  tipo: matriculaTipoCobrancaDTOSchema,
  vencimento: dateStringDTOSchema,
  descricao: nullableStringDTOSchema.default(null),
  asaasPaymentId: nullableStringDTOSchema.default(null),
  asaasId: nullableStringDTOSchema.default(null),
  createdAt: dateStringDTOSchema,
  competenciaInicio: dateStringDTOSchema,
  competenciaFim: dateStringDTOSchema,
  dataPagamento: nullableDateStringDTOSchema.default(null),
  origin: z.enum(['ACADEMIC', 'STANDALONE']).default('ACADEMIC').optional(),
});
export type MatriculaCobrancaDTO = z.infer<typeof matriculaCobrancaDTOSchema>;

export const matriculaResumoDTOSchema = z.object({
  id: z.string(),
  status: matriculaStatusDTOSchema,
  statusFinanceiro: matriculaStatusFinanceiroDTOSchema.nullable().optional(),
  statusContrato: matriculaStatusContratoDTOSchema.nullable().optional(),
  dataInicio: dateStringDTOSchema,
  dataFimContrato: nullableDateStringDTOSchema.default(null),
  taxaMatricula: z.number(),
  taxaStatus: matriculaTaxaStatusDTOSchema,
  taxaIsenta: z.boolean(),
  vencimentoDia: z.number().int(),
  aluno: matriculaAlunoResumoDTOSchema,
  plano: matriculaPlanoResumoDTOSchema.nullable().default(null),
  responsavelFinanceiro: matriculaResponsavelResumoDTOSchema.nullable().default(null),
  turma: matriculaTurmaResumoDTOSchema.nullable().default(null),
  turmas: z.array(matriculaTurmaResumoDTOSchema).default([]),
  combo: matriculaComboResumoDTOSchema.nullable().default(null),
  cobrancas: z.array(matriculaCobrancaDTOSchema).default([]),
  contratos: z.array(matriculaContratoResumoDTOSchema).default([]),
  asaasSubscriptionId: nullableStringDTOSchema.default(null).optional(),
  pausaAtiva: z.boolean().default(false).optional(),
  dataInicioPausa: nullableDateStringDTOSchema.default(null).optional(),
  dataRetornoPrevista: nullableDateStringDTOSchema.default(null).optional(),
  manterVaga: z.boolean().default(true).optional(),
  cobrarDurantePausa: z.boolean().default(false).optional(),
  motivoPausa: nullableStringDTOSchema.default(null).optional(),
  integrationStatus: matriculaIntegrationStatusDTOSchema.default('SINCRONIZADO').optional(),
  warningCode: nullableStringDTOSchema.default(null).optional(),
  jurosMensal: z.number().nullable().optional(),
  jurosTipo: nullableStringDTOSchema.default(null).optional(),
  multaPercentual: z.number().nullable().optional(),
  multaTipo: nullableStringDTOSchema.default(null).optional(),
  descontoAntecipado: z.number().nullable().optional(),
  descontoTipo: nullableStringDTOSchema.default(null).optional(),
  prazoDesconto: z.number().nullable().optional(),
  assinaturaSnapshot: z
    .object({
      asaasSubscriptionId: z.string(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']),
      billingType: matriculaBillingTypeDTOSchema.nullable().default(null),
      value: z.number().nullable().default(null),
      nextDueDate: nullableDateStringDTOSchema.default(null),
      deleted: z.boolean().default(false),
      syncError: nullableStringDTOSchema.default(null),
      syncedAt: nullableDateStringDTOSchema.default(null),
    })
    .nullable()
    .default(null)
    .optional(),
  financialContext: z
    .object({
      mode: z.enum(['INDIVIDUAL', 'FAMILY']),
      sourceMatriculaId: z.string(),
      targetMatriculaId: z.string(),
      familyGroupId: nullableStringDTOSchema.default(null),
      responsavelFinanceiro: matriculaResponsavelResumoDTOSchema.nullable().default(null),
      affectedMatriculaIds: z.array(z.string()).default([]),
      alunos: z
        .array(
          z.object({
            matriculaId: z.string(),
            alunoId: z.string(),
            nome: z.string(),
          }),
        )
        .default([]),
    })
    .nullable()
    .default(null)
    .optional(),
});
export type MatriculaResumoDTO = z.infer<typeof matriculaResumoDTOSchema>;

export const listMatriculasResultDTOSchema = z.object({
  matriculas: z.array(matriculaResumoDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  data: z.array(matriculaResumoDTOSchema),
  pageSize: z.number().int().positive(),
});
export type ListMatriculasResultDTO = z.infer<typeof listMatriculasResultDTOSchema>;

export const matriculaCoreDTOSchema = z.object({
  id: z.string(),
  alunoId: z.string(),
  responsavelFinanceiroId: nullableStringDTOSchema.default(null),
  planoId: nullableStringDTOSchema.default(null),
  turmaId: nullableStringDTOSchema.default(null),
  comboId: nullableStringDTOSchema.default(null),
  status: matriculaStatusDTOSchema,
  statusContrato: matriculaStatusContratoDTOSchema.nullable().optional(),
  statusFinanceiro: matriculaStatusFinanceiroDTOSchema.nullable().optional(),
  dataInicio: dateStringDTOSchema,
  dataFimContrato: nullableDateStringDTOSchema.default(null),
  taxaMatricula: z.number(),
  taxaStatus: matriculaTaxaStatusDTOSchema,
  taxaIsenta: z.boolean(),
  taxaJustificativa: nullableStringDTOSchema.default(null).optional(),
  vencimentoDia: z.number().int(),
  asaasId: nullableStringDTOSchema.default(null),
  asaasSubscriptionId: nullableStringDTOSchema.default(null).optional(),
  createdAt: dateStringDTOSchema,
  updatedAt: dateStringDTOSchema,
});
export type MatriculaCoreDTO = z.infer<typeof matriculaCoreDTOSchema>;

export const matriculaOperacaoPausaResumoDTOSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  status: z.string(),
  createdAt: dateStringDTOSchema,
  processedAt: nullableDateStringDTOSchema.default(null),
  observacao: nullableStringDTOSchema.default(null),
  cobrancasFuturasRemovidas: z.number().int().nonnegative().default(0),
  warnings: z.array(z.string()).default([]),
});
export type MatriculaOperacaoPausaResumoDTO = z.infer<typeof matriculaOperacaoPausaResumoDTOSchema>;

export const matriculaPausaResumoDTOSchema = z.object({
  matriculaId: z.string(),
  status: matriculaStatusDTOSchema,
  pausaAtiva: z.boolean(),
  dataInicioPausa: nullableDateStringDTOSchema.default(null),
  dataRetornoPrevista: nullableDateStringDTOSchema.default(null),
  manterVaga: z.boolean(),
  cobrarDurantePausa: z.boolean(),
  motivoPausa: nullableStringDTOSchema.default(null),
  integrationStatus: matriculaIntegrationStatusDTOSchema,
  warningCode: nullableStringDTOSchema.default(null),
  asaasSubscriptionId: nullableStringDTOSchema.default(null),
  operacoes: z.array(matriculaOperacaoPausaResumoDTOSchema).default([]),
});
export type MatriculaPausaResumoDTO = z.infer<typeof matriculaPausaResumoDTOSchema>;

export const pausarMatriculaResultDTOSchema = z.object({
  matriculaId: z.string(),
  operacaoId: z.string(),
  correlationId: z.string(),
  previousStatus: matriculaStatusDTOSchema,
  newStatus: z.literal('PAUSADA'),
  manterVaga: z.boolean(),
  cobrarDurantePausa: z.boolean(),
  integrationStatus: matriculaIntegrationStatusDTOSchema,
  warningCode: nullableStringDTOSchema.default(null),
  asaasAction: z.enum(['SUBSCRIPTION_INACTIVATED', 'LOCAL_ONLY', 'SKIPPED_COBRAR_DURANTE_PAUSA']),
  cobrancasFuturasRemovidas: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});
export type PausarMatriculaResultDTO = z.infer<typeof pausarMatriculaResultDTOSchema>;

export const reativarMatriculaResultDTOSchema = z.object({
  matriculaId: z.string(),
  operacaoId: z.string(),
  correlationId: z.string(),
  previousStatus: matriculaStatusDTOSchema,
  newStatus: z.literal('ATIVA'),
  integrationStatus: matriculaIntegrationStatusDTOSchema,
  warningCode: nullableStringDTOSchema.default(null),
  asaasAction: z.enum(['SUBSCRIPTION_UPDATED', 'LOCAL_ONLY']),
  warnings: z.array(z.string()).default([]),
});
export type ReativarMatriculaResultDTO = z.infer<typeof reativarMatriculaResultDTOSchema>;

export const createMatriculaPrecoDTOSchema = z.object({
  plano: z.number(),
  planoLiquido: z.number(),
  taxa: z.number(),
  descontosAplicados: z.array(z.number()),
  total: z.number(),
});
export type CreateMatriculaPrecoDTO = z.infer<typeof createMatriculaPrecoDTOSchema>;

export const createMatriculaResultDTOSchema = z.object({
  matricula: matriculaCoreDTOSchema,
  cobrancas: z.object({
    taxa: matriculaCobrancaDTOSchema.nullable(),
    mensalidade: matriculaCobrancaDTOSchema.nullable(),
  }),
  preco: createMatriculaPrecoDTOSchema,
  asaasSync: z
    .object({
      taxa: z
        .object({
          success: z.boolean(),
          error: nullableStringDTOSchema.default(null).optional(),
          asaasPaymentId: nullableStringDTOSchema.default(null).optional(),
          invoiceUrl: nullableStringDTOSchema.default(null).optional(),
          bankSlipUrl: nullableStringDTOSchema.default(null).optional(),
        })
        .nullable()
        .optional(),
      subscription: z
        .object({
          success: z.boolean(),
          error: nullableStringDTOSchema.default(null).optional(),
          asaasSubscriptionId: nullableStringDTOSchema.default(null).optional(),
          asaasPaymentId: nullableStringDTOSchema.default(null).optional(),
          invoiceUrl: nullableStringDTOSchema.default(null).optional(),
          bankSlipUrl: nullableStringDTOSchema.default(null).optional(),
          message: nullableStringDTOSchema.default(null).optional(),
          expectedWebhooks: z.array(z.string()).default([]).optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  responsavelFinanceiro: matriculaResponsavelResumoDTOSchema.nullable(),
  primeiroVencimento: dateStringDTOSchema,
  notificationSync: z
    .object({
      applied: matriculaNotificationChannelsDTOSchema,
      warnings: z.array(matriculaNotificationWarningDTOSchema).default([]),
    })
    .nullable()
    .optional(),
});
export type CreateMatriculaResultDTO = z.infer<typeof createMatriculaResultDTOSchema>;

export const updateMatriculaResultDTOSchema = z.object({
  data: matriculaCoreDTOSchema,
});
export type UpdateMatriculaResultDTO = z.infer<typeof updateMatriculaResultDTOSchema>;

export const editMatriculaResultDTOSchema = z.object({
  data: z.object({
    id: z.string(),
    turmaId: nullableStringDTOSchema.default(null),
    comboId: nullableStringDTOSchema.default(null),
    planoId: nullableStringDTOSchema.default(null),
    asaasSubscriptionId: nullableStringDTOSchema.default(null),
  }),
});
export type EditMatriculaResultDTO = z.infer<typeof editMatriculaResultDTOSchema>;

export const matriculaStatusSyncActionDTOSchema = z.enum([
  'SUSPEND',
  'ACTIVATE',
  'DELETE',
  'LOCAL_ONLY',
  'NONE',
]);
export type MatriculaStatusSyncActionDTO = z.infer<typeof matriculaStatusSyncActionDTOSchema>;

export const matriculaPaymentSyncDetailDTOSchema = z.object({
  cobrancaId: z.string(),
  asaasPaymentId: nullableStringDTOSchema.default(null),
  novoStatus: matriculaCobrancaStatusDTOSchema,
  source: z.enum(['ASAAS', 'LOCAL']),
});
export type MatriculaPaymentSyncDetailDTO = z.infer<typeof matriculaPaymentSyncDetailDTOSchema>;

export const matriculaPaymentSyncInfoDTOSchema = z.object({
  totalFromAsaas: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
  expectedWebhooks: z.array(z.string()).default([]),
  details: z.array(matriculaPaymentSyncDetailDTOSchema).default([]),
});
export type MatriculaPaymentSyncInfoDTO = z.infer<typeof matriculaPaymentSyncInfoDTOSchema>;

export const matriculaStatusSyncDataDTOSchema = z.object({
  matriculaId: z.string(),
  status: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']),
  previousStatus: z.enum(['ATIVA', 'PAUSADA', 'CANCELADA']),
  asaasAction: matriculaStatusSyncActionDTOSchema,
  cobrancasAtualizadas: z.number().int().nonnegative(),
  nextDueDate: nullableDateStringDTOSchema.default(null),
  paymentSync: matriculaPaymentSyncInfoDTOSchema,
});
export type MatriculaStatusSyncDataDTO = z.infer<typeof matriculaStatusSyncDataDTOSchema>;

export const matriculaStatusSyncResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: matriculaStatusSyncDataDTOSchema,
});
export type MatriculaStatusSyncResultDTO = z.infer<typeof matriculaStatusSyncResultDTOSchema>;

export const matriculaDeleteResultDTOSchema = z.object({
  success: z.boolean(),
  action: z.enum(['CANCELADA', 'HARD_DELETED']),
  hardDelete: z.boolean().optional(),
  blockedBy: z
    .object({
      cobrancas: z.number().int().nonnegative(),
      pagamentos: z.number().int().nonnegative(),
      subscriptions: z.number().int().nonnegative(),
      installmentPlans: z.number().int().nonnegative(),
      contratoComAceite: z.number().int().nonnegative(),
      asaasSubscriptionId: nullableStringDTOSchema.default(null),
    })
    .optional(),
  data: z.unknown().optional(),
  deletedId: z.string().optional(),
});
export type MatriculaDeleteResultDTO = z.infer<typeof matriculaDeleteResultDTOSchema>;

export const matriculaReenviarCobrancaResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  asaasPaymentId: nullableStringDTOSchema.default(null).optional(),
  status: nullableStringDTOSchema.default(null).optional(),
  invoiceUrl: nullableStringDTOSchema.default(null),
  bankSlipUrl: nullableStringDTOSchema.default(null),
  pixQrCodeUrl: nullableStringDTOSchema.default(null),
  pixCopyPaste: nullableStringDTOSchema.default(null),
});
export type MatriculaReenviarCobrancaResultDTO = z.infer<
  typeof matriculaReenviarCobrancaResultDTOSchema
>;

export const matriculaGerarPixResultDTOSchema = z.object({
  success: z.boolean(),
  pixId: z.string(),
  cobrancaId: z.string(),
  matriculaId: z.string(),
  qrCode: z.string(),
  payload: z.string(),
  valor: z.number(),
  vencimento: z.union([dateStringDTOSchema, z.date()]),
});
export type MatriculaGerarPixResultDTO = z.infer<typeof matriculaGerarPixResultDTOSchema>;

export const matriculaSubscriptionValueUpdateResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    subscriptionId: z.string(),
    value: z.number(),
    updatePendingPayments: z.boolean(),
  }),
});
export type MatriculaSubscriptionValueUpdateResultDTO = z.infer<
  typeof matriculaSubscriptionValueUpdateResultDTOSchema
>;

export const matriculaSubscriptionBillingTypeUpdateResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    billingType: matriculaBillingTypeDTOSchema,
  }),
});
export type MatriculaSubscriptionBillingTypeUpdateResultDTO = z.infer<
  typeof matriculaSubscriptionBillingTypeUpdateResultDTOSchema
>;

export const matriculaSubscriptionTermsUpdateResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    interest: matriculaAdjustmentDTOSchema.optional(),
    fine: matriculaAdjustmentDTOSchema.optional(),
    discount: matriculaDiscountDTOSchema.optional(),
    updated: z.object({
      jurosMensal: z.number().nullable(),
      jurosTipo: nullableStringDTOSchema.default(null),
      multaPercentual: z.number().nullable(),
      multaTipo: nullableStringDTOSchema.default(null),
      descontoAntecipado: z.number().nullable(),
      descontoTipo: nullableStringDTOSchema.default(null),
      prazoDesconto: z.number().nullable(),
    }),
  }),
});
export type MatriculaSubscriptionTermsUpdateResultDTO = z.infer<
  typeof matriculaSubscriptionTermsUpdateResultDTOSchema
>;
