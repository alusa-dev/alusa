import { z } from 'zod';

const isoDateStringDTOSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida');
const nullableStringDTOSchema = z.string().nullable();
const nullableNumberDTOSchema = z.number().nullable();

export const portalRoleDTOSchema = z.enum(['ALUNO', 'RESPONSAVEL']);
export type PortalRoleDTO = z.infer<typeof portalRoleDTOSchema>;

export const portalDashboardQueryDTOSchema = z.object({
  alunoId: z.string().trim().optional(),
});
export type PortalDashboardQueryDTO = z.infer<typeof portalDashboardQueryDTOSchema>;

export const portalRouteIdParamsDTOSchema = z.object({
  id: z.string().min(1),
});
export type PortalRouteIdParamsDTO = z.infer<typeof portalRouteIdParamsDTOSchema>;

export const portalContratoTokenParamsDTOSchema = z.object({
  token: z.string().min(1),
});
export type PortalContratoTokenParamsDTO = z.infer<typeof portalContratoTokenParamsDTOSchema>;

export const portalResponsavelAlunoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  foto: nullableStringDTOSchema.default(null),
  idade: nullableNumberDTOSchema.default(null),
});
export type PortalResponsavelAlunoDTO = z.infer<typeof portalResponsavelAlunoDTOSchema>;

export const portalResponsavelAlunosResultDTOSchema = z.object({
  alunos: z.array(portalResponsavelAlunoDTOSchema),
});
export type PortalResponsavelAlunosResultDTO = z.infer<
  typeof portalResponsavelAlunosResultDTOSchema
>;

export const portalDashboardResultDTOSchema = z.object({
  matriculas: z.object({
    ativas: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  financeiro: z.object({
    pendentes: z.number().int().nonnegative(),
    totalPendente: z.number(),
    proxVencimento: z
      .object({
        data: isoDateStringDTOSchema,
        valor: z.number(),
      })
      .optional(),
  }),
  eventos: z.object({
    proximos: z.number().int().nonnegative(),
  }),
});
export type PortalDashboardResultDTO = z.infer<typeof portalDashboardResultDTOSchema>;

export const portalEventoInscricaoDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  quantidade: z.number().int().positive(),
  valorTotal: z.number(),
  qrCode: z.string(),
});
export type PortalEventoInscricaoDTO = z.infer<typeof portalEventoInscricaoDTOSchema>;

export const portalEventoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: nullableStringDTOSchema.default(null),
  dataInicio: isoDateStringDTOSchema,
  dataFim: nullableStringDTOSchema.default(null),
  local: z.string(),
  tipo: z.string(),
  capacidade: z.number().int().nullable().default(null),
  status: z.string(),
  inscricao: portalEventoInscricaoDTOSchema.optional(),
});
export type PortalEventoDTO = z.infer<typeof portalEventoDTOSchema>;

export const portalEventosResultDTOSchema = z.object({
  eventos: z.array(portalEventoDTOSchema),
});
export type PortalEventosResultDTO = z.infer<typeof portalEventosResultDTOSchema>;

export const portalFinanceiroPagamentoDTOSchema = z.object({
  id: z.string(),
  dataPagamento: nullableStringDTOSchema.default(null),
  valorPago: z.number(),
  status: z.string(),
  formaPagamento: nullableStringDTOSchema.default(null).optional(),
});
export type PortalFinanceiroPagamentoDTO = z.infer<typeof portalFinanceiroPagamentoDTOSchema>;

export const portalFinanceiroCardInfoDTOSchema = z.object({
  hasSavedCard: z.boolean().default(false),
  creditCardBrand: nullableStringDTOSchema.default(null),
  creditCardLast4: nullableStringDTOSchema.default(null),
  creditCardExpiryMonth: z.number().int().nullable().default(null).optional(),
  creditCardExpiryYear: z.number().int().nullable().default(null).optional(),
});
export type PortalFinanceiroCardInfoDTO = z.infer<typeof portalFinanceiroCardInfoDTOSchema>;

export const portalFinanceiroListItemDTOSchema = z.object({
  id: z.string(),
  valor: z.number(),
  vencimento: isoDateStringDTOSchema,
  status: z.string(),
  formaPagamento: nullableStringDTOSchema.default(null),
  asaasId: nullableStringDTOSchema.default(null).optional(),
  invoiceUrl: nullableStringDTOSchema.default(null).optional(),
  matricula: z.object({
    aluno: z.object({
      nome: z.string(),
    }),
    turma: z
      .object({
        nome: z.string(),
        modalidade: z.object({
          nome: z.string(),
        }),
      })
      .nullable()
      .default(null),
    responsavelFinanceiro: portalFinanceiroCardInfoDTOSchema.nullable().default(null),
  }),
  pagamentos: z.array(portalFinanceiroPagamentoDTOSchema),
});
export type PortalFinanceiroListItemDTO = z.infer<typeof portalFinanceiroListItemDTOSchema>;

export const portalFinanceiroListResultDTOSchema = z.object({
  cobrancas: z.array(portalFinanceiroListItemDTOSchema),
});
export type PortalFinanceiroListResultDTO = z.infer<typeof portalFinanceiroListResultDTOSchema>;

export const portalFinanceiroDetailDTOSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  valor: z.number(),
  vencimento: isoDateStringDTOSchema,
  status: z.string(),
  formaPagamento: nullableStringDTOSchema.default(null),
  asaasPaymentId: nullableStringDTOSchema.default(null),
  asaasId: nullableStringDTOSchema.default(null),
  invoiceUrl: nullableStringDTOSchema.default(null),
  transactionReceiptUrl: nullableStringDTOSchema.default(null).optional(),
  descricao: nullableStringDTOSchema.default(null),
  valorJuros: nullableNumberDTOSchema.default(null),
  valorMulta: nullableNumberDTOSchema.default(null),
  valorDesconto: nullableNumberDTOSchema.default(null),
  asaasData: z
    .object({
      invoiceUrl: nullableStringDTOSchema.default(null).optional(),
      transactionReceiptUrl: nullableStringDTOSchema.default(null).optional(),
      status: nullableStringDTOSchema.default(null).optional(),
      value: z.number().nullable().optional(),
      dueDate: nullableStringDTOSchema.default(null).optional(),
      billingType: nullableStringDTOSchema.default(null).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  matricula: z.object({
    aluno: z.object({
      nome: z.string(),
      cpf: nullableStringDTOSchema.default(null),
      email: nullableStringDTOSchema.default(null).optional(),
      telefone: nullableStringDTOSchema.default(null).optional(),
    }),
    turma: z
      .object({
        nome: z.string(),
        modalidade: z.object({
          nome: z.string(),
        }),
      })
      .nullable()
      .default(null),
    responsavelFinanceiro: portalFinanceiroCardInfoDTOSchema.nullable().default(null),
  }),
  pagamentos: z.array(portalFinanceiroPagamentoDTOSchema),
});
export type PortalFinanceiroDetailDTO = z.infer<typeof portalFinanceiroDetailDTOSchema>;

export const portalMatriculaDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  dataInicio: isoDateStringDTOSchema,
  dataFimContrato: isoDateStringDTOSchema,
  aluno: z.object({
    nome: z.string(),
    foto: nullableStringDTOSchema.default(null),
  }),
  turma: z
    .object({
      nome: z.string(),
      modalidade: z.object({
        nome: nullableStringDTOSchema.default(null),
      }),
      diasSemana: z.array(z.string()).default([]),
      horaInicio: nullableStringDTOSchema.default(null),
      horaFim: nullableStringDTOSchema.default(null),
    })
    .nullable()
    .default(null),
  plano: z
    .object({
      nome: z.string(),
      valor: z.number(),
      periodicidade: z.string(),
    })
    .nullable()
    .default(null),
  combo: z
    .object({
      nome: z.string(),
    })
    .nullable()
    .optional(),
  cobrancas: z.object({
    pendentes: z.number().int().nonnegative(),
    totalPendente: z.number(),
  }),
});
export type PortalMatriculaDTO = z.infer<typeof portalMatriculaDTOSchema>;

export const portalMatriculasResultDTOSchema = z.object({
  matriculas: z.array(portalMatriculaDTOSchema),
});
export type PortalMatriculasResultDTO = z.infer<typeof portalMatriculasResultDTOSchema>;

export const portalNotificationsResultDTOSchema = z.object({
  cobrancasPendentes: z.number().int().nonnegative(),
  cobrancasAtrasadas: z.number().int().nonnegative(),
  proximosEventos: z.number().int().nonnegative(),
});
export type PortalNotificationsResultDTO = z.infer<typeof portalNotificationsResultDTOSchema>;

export const portalPerfilInputDTOSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().min(10, 'Telefone inválido'),
  enderecoCep: z.string().optional(),
  enderecoLogradouro: z.string().optional(),
  enderecoNumero: z.string().optional(),
  enderecoComplemento: z.string().optional(),
  enderecoBairro: z.string().optional(),
  enderecoCidade: z.string().optional(),
  enderecoUf: z.string().optional(),
});
export type PortalPerfilInputDTO = z.infer<typeof portalPerfilInputDTOSchema>;

export const portalPerfilDTOSchema = z.object({
  tipo: portalRoleDTOSchema,
  nome: z.string(),
  email: nullableStringDTOSchema.default(null),
  telefone: nullableStringDTOSchema.default(null),
  cpf: nullableStringDTOSchema.default(null).optional(),
  dataNasc: nullableStringDTOSchema.default(null).optional(),
  enderecoCep: nullableStringDTOSchema.default(null),
  enderecoLogradouro: nullableStringDTOSchema.default(null),
  enderecoNumero: nullableStringDTOSchema.default(null),
  enderecoComplemento: nullableStringDTOSchema.default(null),
  enderecoBairro: nullableStringDTOSchema.default(null),
  enderecoCidade: nullableStringDTOSchema.default(null),
  enderecoUf: nullableStringDTOSchema.default(null),
});
export type PortalPerfilDTO = z.infer<typeof portalPerfilDTOSchema>;
