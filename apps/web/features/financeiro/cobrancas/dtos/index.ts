import { z } from 'zod';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);
const notifyTypeDTOSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP']);
const manualPaymentMethodDTOSchema = z.enum(['DINHEIRO', 'PIX', 'TRANSFERENCIA']);

function isValidCobrancaUpdateDueDate(value: string): boolean {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  return Number.isFinite(new Date(value).getTime());
}

const cobrancaUpdateDueDateDTOSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isValidCobrancaUpdateDueDate, 'Informe uma data de vencimento válida');

export const financeiroCobrancasQueryDTOSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(20),
  status: z.array(z.string()).default([]),
  tipo: z.array(z.string()).default([]),
  q: z.string().trim().optional(),
  statusView: z.enum(['open', 'paid', 'all']).default('open'),
  origin: z.string().default('all'),
  groupInstallments: z.boolean().default(true),
  scope: z.string().optional(),
});

export type FinanceiroCobrancasQueryDTO = z.infer<typeof financeiroCobrancasQueryDTOSchema>;

export const financeiroCobrancaInstallmentDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  asaasStatus: z.string().nullable().optional(),
  displayStatus: z
    .object({
      status: z.string(),
      label: z.string(),
      hint: z.string().nullable(),
      variant: z.enum(['success', 'warning', 'danger', 'info', 'neutral']),
    })
    .optional(),
  valor: z.number(),
  vencimento: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  asaasPaymentId: z.string().nullable().optional(),
});

export type FinanceiroCobrancaInstallmentDTO = z.infer<typeof financeiroCobrancaInstallmentDTOSchema>;

export const financeiroCobrancaListItemDTOSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  formaPagamento: z.string().nullable().optional(),
  status: z.string(),
  asaasStatus: z.string().nullable().optional(),
  liquidacaoStatus: z.string().nullable().optional(),
  displayStatus: z
    .object({
      status: z.string(),
      label: z.string(),
      hint: z.string().nullable(),
      variant: z.enum(['success', 'warning', 'danger', 'info', 'neutral']),
    })
    .optional(),
  valor: z.number(),
  vencimento: z.string().nullable().optional(),
  aluno: z.object({
    id: z.string(),
    nome: z.string(),
  }),
  matriculaId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  asaasPaymentId: z.string().nullable().optional(),
  atrasado: z.boolean(),
  origin: z.string(),
  description: z.string().nullable().optional(),
  isGroup: z.boolean(),
  groupType: z.string().nullable().optional(),
  installmentPlanId: z.string().nullable().optional(),
  installmentCount: z.number().int().nullable().optional(),
  installmentsPaid: z.number().int().nullable().optional(),
  installments: z.array(financeiroCobrancaInstallmentDTOSchema).nullable().optional(),
});

export type FinanceiroCobrancaListItemDTO = z.infer<typeof financeiroCobrancaListItemDTOSchema>;

export const listFinanceiroCobrancasResultDTOSchema = z.object({
  data: z.array(financeiroCobrancaListItemDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type ListFinanceiroCobrancasResultDTO = z.infer<typeof listFinanceiroCobrancasResultDTOSchema>;

export const financeiroCobrancaCancelResultDTOSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  pending: z.boolean().optional(),
});

export type FinanceiroCobrancaCancelResultDTO = z.infer<typeof financeiroCobrancaCancelResultDTOSchema>;

export const cobrancaRouteParamsDTOSchema = z.object({
  id: z.string().min(1),
});

export type CobrancaRouteParamsDTO = z.infer<typeof cobrancaRouteParamsDTOSchema>;

export const cobrancaArquivoIdQueryDTOSchema = z.object({
  arquivoId: z.string().min(1),
});

export type CobrancaArquivoIdQueryDTO = z.infer<typeof cobrancaArquivoIdQueryDTOSchema>;

export const cobrancaArquivoDTOSchema = z
  .object({
    id: z.string(),
    cobrancaId: z.string().nullable().optional(),
    chargeId: z.string().nullable().optional(),
    nomeOriginal: z.string(),
    nomeArquivo: z.string(),
    mimetype: z.string(),
    tamanho: z.number().int().nonnegative(),
    url: z.string(),
    uploadPor: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export type CobrancaArquivoDTO = z.infer<typeof cobrancaArquivoDTOSchema>;

export const listCobrancaArquivosResultDTOSchema = z.object({
  arquivos: z.array(cobrancaArquivoDTOSchema),
});

export type ListCobrancaArquivosResultDTO = z.infer<typeof listCobrancaArquivosResultDTOSchema>;

export const uploadCobrancaArquivoResultDTOSchema = z.object({
  arquivo: cobrancaArquivoDTOSchema,
});

export type UploadCobrancaArquivoResultDTO = z.infer<typeof uploadCobrancaArquivoResultDTOSchema>;

export const deleteCobrancaArquivoResultDTOSchema = z.object({
  success: z.literal(true),
});

export type DeleteCobrancaArquivoResultDTO = z.infer<typeof deleteCobrancaArquivoResultDTOSchema>;

export const listLegacyCobrancasQueryDTOSchema = z.object({
  matriculaId: z.string().trim().optional(),
  status: z
    .enum([
      'A_VENCER',
      'PENDENTE',
      'PROCESSANDO',
      'PAGO',
      'ATRASADO',
      'CANCELAMENTO_PENDENTE',
      'CANCELADO',
      'ESTORNADO',
      'ESTORNADO_PARCIAL',
    ])
    .optional(),
  tipo: z
    .enum(['TAXA_MATRICULA', 'MENSALIDADE', 'EXTRA', 'AVULSA', 'PARCELADA', 'RECORRENTE'])
    .optional(),
  dataInicio: z.string().trim().optional(),
  dataFim: z.string().trim().optional(),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().nonnegative().default(0),
});

export type ListLegacyCobrancasQueryDTO = z.infer<typeof listLegacyCobrancasQueryDTOSchema>;

export const legacyCobrancaListItemDTOSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    statusCalculado: z.string(),
    diasAteVencimento: z.number().int(),
    isPago: z.boolean(),
    isEstornado: z.boolean(),
    isCancelado: z.boolean(),
    podeReenviar: z.boolean(),
    vencimento: dateLikeDTOSchema,
    valor: z.union([z.number(), z.string()]),
  })
  .passthrough();

export type LegacyCobrancaListItemDTO = z.infer<typeof legacyCobrancaListItemDTOSchema>;

export const listLegacyCobrancasResultDTOSchema = z.object({
  data: z.array(legacyCobrancaListItemDTOSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

export type ListLegacyCobrancasResultDTO = z.infer<typeof listLegacyCobrancasResultDTOSchema>;

export const createLegacyCobrancaInputDTOSchema = z.object({
  matriculaId: z.string().min(1),
  valor: z.number().positive(),
  vencimento: z.union([z.string(), z.date()]),
  competenciaInicio: z.union([z.string(), z.date()]),
  competenciaFim: z.union([z.string(), z.date()]),
  tipo: z
    .enum(['TAXA_MATRICULA', 'MENSALIDADE', 'EXTRA', 'AVULSA', 'PARCELADA', 'RECORRENTE'])
    .optional(),
  descricao: z.string().optional(),
  formaPagamento: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO', 'INDEFINIDO']).optional(),
});

export type CreateLegacyCobrancaInputDTO = z.input<typeof createLegacyCobrancaInputDTOSchema>;

export const createLegacyCobrancaResultDTOSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
  }).passthrough(),
});

export type CreateLegacyCobrancaResultDTO = z.infer<typeof createLegacyCobrancaResultDTOSchema>;

export const cobrancaDetailResultDTOSchema = z.object({
  success: z.literal(true),
  data: z
    .object({
      id: z.string(),
      tipo: z.string(),
      status: z.string(),
      valor: z.union([z.number(), z.string()]),
      vencimento: dateLikeDTOSchema,
      descricao: z.string().nullable().optional(),
      formaPagamento: z.string().nullable().optional(),
      atrasado: z.boolean(),
      asaasPaymentId: z.string().nullable().optional(),
      valorBruto: z.union([z.number(), z.string()]).nullable().optional(),
      valorLiquido: z.union([z.number(), z.string()]).nullable().optional(),
      taxaAsaas: z.union([z.number(), z.string()]).nullable().optional(),
      liquidacaoStatus: z.string().nullable().optional(),
      installmentPlanId: z.string().nullable().optional(),
      subscriptionId: z.string().nullable().optional(),
      origin: z.string().optional(),
    })
    .passthrough(),
});

export type CobrancaDetailResultDTO = z.infer<typeof cobrancaDetailResultDTOSchema>;

export const cobrancaMutationResultDTOSchema = z.object({
  success: z.literal(true),
  data: z
    .object({
      id: z.string(),
    })
    .passthrough()
    .optional(),
  message: z.string().optional(),
  pending: z.boolean().optional(),
});

export type CobrancaMutationResultDTO = z.infer<typeof cobrancaMutationResultDTOSchema>;

/**
 * Mantém compatibilidade com clientes legados que enviam valores monetários
 * como string, mas garante que a camada de aplicação receba apenas números
 * finitos antes de iniciar uma mutação financeira.
 */
const numberLikeCobrancaUpdateDTOSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .refine(Number.isFinite, 'Informe um número válido');

const optionalNumberLikeCobrancaUpdateDTOSchema = numberLikeCobrancaUpdateDTOSchema.optional();

/**
 * Payload do endpoint legado PUT /api/cobrancas/[id].
 *
 * O schema é permissivo para os aliases e campos históricos que ainda são
 * enviados pelas telas, mas não deixa valores inválidos chegarem ao Prisma ou
 * ao comando financeiro externo. Campos desconhecidos são preservados para
 * que a validação seja uma migração compatível: a rota continua ignorando-os
 * como fazia antes.
 */
export const cobrancaUpdateInputDTOSchema = z
  .object({
    valor: optionalNumberLikeCobrancaUpdateDTOSchema,
    vencimento: cobrancaUpdateDueDateDTOSchema.optional(),
    descricao: z.string().nullable().optional(),
    formaPagamento: z.unknown().optional(),
    jurosPercentual: optionalNumberLikeCobrancaUpdateDTOSchema,
    jurosValorFixo: optionalNumberLikeCobrancaUpdateDTOSchema,
    juros: optionalNumberLikeCobrancaUpdateDTOSchema,
    multaTipo: z.string().nullable().optional(),
    multaPercentual: optionalNumberLikeCobrancaUpdateDTOSchema,
    multaValorFixo: optionalNumberLikeCobrancaUpdateDTOSchema,
    multa: optionalNumberLikeCobrancaUpdateDTOSchema,
    descontoTipo: z.string().nullable().optional(),
    descontoPercentual: optionalNumberLikeCobrancaUpdateDTOSchema,
    descontoValorFixo: optionalNumberLikeCobrancaUpdateDTOSchema,
    descontoPrazoMaximo: z.string().nullable().optional(),
    desconto: optionalNumberLikeCobrancaUpdateDTOSchema,
    valorFinal: optionalNumberLikeCobrancaUpdateDTOSchema,
  })
  .passthrough();

export type CobrancaUpdateInputDTO = z.infer<typeof cobrancaUpdateInputDTOSchema>;

export const cobrancaNotifyInputDTOSchema = z.object({
  tipo: notifyTypeDTOSchema,
});

export type CobrancaNotifyInputDTO = z.infer<typeof cobrancaNotifyInputDTOSchema>;

export const cobrancaNotifyResultDTOSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  tipo: notifyTypeDTOSchema.optional(),
  invoiceUrl: z.string().url().optional(),
  bankSlipUrl: z.string().url().optional(),
  pixQrCodeUrl: z.string().optional(),
  pixCopyPaste: z.string().optional(),
  error: z.string().optional(),
});

export type CobrancaNotifyResultDTO = z.infer<typeof cobrancaNotifyResultDTOSchema>;

export const cobrancaConfirmarRecebimentoInputDTOSchema = z.object({
  dataPagamento: z.string().optional(),
  formaPagamentoManual: manualPaymentMethodDTOSchema.optional(),
  observacao: z.string().max(500).optional(),
  notifyCustomer: z.boolean().optional(),
});

export type CobrancaConfirmarRecebimentoInputDTO = z.infer<
  typeof cobrancaConfirmarRecebimentoInputDTOSchema
>;

export const cobrancaRefundInputDTOSchema = z.object({
  value: z.number().positive().optional(),
  description: z.string().max(500).optional(),
  splitRefunds: z
    .array(
      z.object({
        id: z.string().min(1),
        value: z.number().positive(),
      }),
    )
    .optional(),
});

export type CobrancaRefundInputDTO = z.infer<typeof cobrancaRefundInputDTOSchema>;

export const cobrancaUpdateFormaPagamentoInputDTOSchema = z.object({
  formaPagamento: z
    .enum(['PIX', 'BOLETO', 'CARTAO_CREDITO', 'INDEFINIDO', 'CREDIT_CARD'])
    .transform((value) => (value === 'CREDIT_CARD' ? 'CARTAO_CREDITO' : value)),
});

export type CobrancaUpdateFormaPagamentoInputDTO = z.infer<
  typeof cobrancaUpdateFormaPagamentoInputDTOSchema
>;

export const cobrancaUpdateFormaPagamentoResultDTOSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
    details: z.record(z.unknown()).optional(),
    data: z
      .object({
        cobranca: z.object({ id: z.string() }).passthrough(),
        asaasData: z.object({ id: z.string() }).passthrough(),
      })
      .optional(),
  })
  .passthrough();

export type CobrancaUpdateFormaPagamentoResultDTO = z.infer<
  typeof cobrancaUpdateFormaPagamentoResultDTOSchema
>;

export const cobrancaActionResultDTOSchema = z
  .object({
    success: z.boolean(),
    pending: z.boolean().optional(),
    alreadyReceived: z.boolean().optional(),
    message: z.string().optional(),
    correlationId: z.string().optional(),
    refundValue: z.number().optional(),
    tipo: notifyTypeDTOSchema.optional(),
    data: z
      .object({
        cobrancaId: z.string(),
        paymentDateStr: z.string(),
      })
      .optional(),
  })
  .passthrough();

export type CobrancaActionResultDTO = z.infer<typeof cobrancaActionResultDTOSchema>;
