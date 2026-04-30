import { z } from 'zod';

export const financeiroRouteIdParamsDTOSchema = z.object({
  id: z.string().min(1),
});

export type FinanceiroRouteIdParamsDTO = z.infer<typeof financeiroRouteIdParamsDTOSchema>;

export const financeiroKpiDataDTOSchema = z.object({
  valorBruto: z.number(),
  valorLiquido: z.number(),
  quantidadeDeCobrancas: z.number().int().nonnegative(),
  quantidadeDeClientes: z.number().int().nonnegative(),
});

export type FinanceiroKpiDataDTO = z.infer<typeof financeiroKpiDataDTOSchema>;

export const financeiroKpisResultDTOSchema = z.object({
  data: z.object({
    recebidas: financeiroKpiDataDTOSchema,
    recebidasEmDinheiro: financeiroKpiDataDTOSchema,
    confirmadas: financeiroKpiDataDTOSchema,
    aguardandoPagamento: financeiroKpiDataDTOSchema,
    vencidas: financeiroKpiDataDTOSchema,
    receitaDoMes: financeiroKpiDataDTOSchema.extend({
      periodo: z.object({
        inicio: z.string(),
        fim: z.string(),
      }),
    }),
    resumo: z.object({
      totalReceitaReal: z.number(),
      totalAReceber: z.number(),
      totalInadimplente: z.number(),
      taxaInadimplencia: z.number(),
    }),
  }),
});

export type FinanceiroKpisResultDTO = z.infer<typeof financeiroKpisResultDTOSchema>;

export const financeiroIndicadoresResultDTOSchema = z.object({
  data: z.object({
    cobrancas: z.object({
      pendentes: z.number().int().nonnegative(),
      pagas: z.number().int().nonnegative(),
      atrasadas: z.number().int().nonnegative(),
      valorPendentes: z.number(),
      valorPagos: z.number(),
    }),
  }),
});

export type FinanceiroIndicadoresResultDTO = z.infer<typeof financeiroIndicadoresResultDTOSchema>;

export const financeiroSaldoQueryDTOSchema = z.object({
  fonte: z.enum(['asaas', 'local']).default('asaas'),
});

export type FinanceiroSaldoQueryDTO = z.infer<typeof financeiroSaldoQueryDTOSchema>;

export const financeiroSaldoResultDTOSchema = z.object({
  data: z.object({
    saldoDisponivel: z.number(),
    fonte: z.enum(['asaas', 'local']),
    consultadoEm: z.string(),
  }),
});

export type FinanceiroSaldoResultDTO = z.infer<typeof financeiroSaldoResultDTOSchema>;

export const financeiroPagamentoAlunoParamsDTOSchema = z.object({
  alunoId: z.string().min(1),
});

export type FinanceiroPagamentoAlunoParamsDTO = z.infer<
  typeof financeiroPagamentoAlunoParamsDTOSchema
>;

export const financeiroPagamentoAlunoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
});

export type FinanceiroPagamentoAlunoDTO = z.infer<typeof financeiroPagamentoAlunoDTOSchema>;

export const financeiroPagamentoCobrancaDTOSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  status: z.string(),
  valor: z.number(),
  vencimento: z.string(),
  aluno: financeiroPagamentoAlunoDTOSchema,
});

export type FinanceiroPagamentoCobrancaDTO = z.infer<typeof financeiroPagamentoCobrancaDTOSchema>;

export const financeiroPagamentoDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  valorPago: z.number(),
  dataPagamento: z.string().nullable(),
  formaPagamento: z.string().nullable().optional(),
  cobrancaId: z.string(),
  cobranca: financeiroPagamentoCobrancaDTOSchema,
  asaasPaymentId: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type FinanceiroPagamentoDTO = z.infer<typeof financeiroPagamentoDTOSchema>;

export const listFinanceiroPagamentosResultDTOSchema = z.object({
  data: z.array(financeiroPagamentoDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export type ListFinanceiroPagamentosResultDTO = z.infer<typeof listFinanceiroPagamentosResultDTOSchema>;

export const financeiroPagamentoSummaryItemDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  cpf: z.string().nullable(),
  foto: z.string().nullable(),
  totalPagamentos: z.number(),
  valorTotal: z.number(),
  ultimoPagamento: z.string().nullable(),
  pagamentosCount: z.number().int().nonnegative(),
});

export type FinanceiroPagamentoSummaryItemDTO = z.infer<
  typeof financeiroPagamentoSummaryItemDTOSchema
>;

export const listFinanceiroPagamentoSummaryResultDTOSchema = z.object({
  data: z.array(financeiroPagamentoSummaryItemDTOSchema),
  total: z.number().int().nonnegative(),
});

export type ListFinanceiroPagamentoSummaryResultDTO = z.infer<
  typeof listFinanceiroPagamentoSummaryResultDTOSchema
>;

export const financeiroPagamentoAlunoResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  cpf: z.string().nullable(),
  foto: z.string().nullable(),
});

export type FinanceiroPagamentoAlunoResumoDTO = z.infer<
  typeof financeiroPagamentoAlunoResumoDTOSchema
>;

export const financeiroPagamentoAlunoHistoricoItemDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  valorPago: z.number(),
  dataPagamento: z.string().nullable(),
  formaPagamento: z.string().nullable(),
  comprovante: z.string().nullable().optional(),
  cobrancaId: z.string(),
  asaasPaymentId: z.string().nullable().optional(),
  createdAt: z.string(),
  cobranca: z.object({
    id: z.string(),
    tipo: z.string(),
    status: z.string(),
    valor: z.number(),
    vencimento: z.string(),
    descricao: z.string().nullable(),
  }),
});

export type FinanceiroPagamentoAlunoHistoricoItemDTO = z.infer<
  typeof financeiroPagamentoAlunoHistoricoItemDTOSchema
>;

export const financeiroPagamentoAlunoHistoricoResultDTOSchema = z.object({
  success: z.literal(true),
  data: z.object({
    aluno: financeiroPagamentoAlunoResumoDTOSchema,
    pagamentos: z.array(financeiroPagamentoAlunoHistoricoItemDTOSchema),
  }),
});

export type FinanceiroPagamentoAlunoHistoricoResultDTO = z.infer<
  typeof financeiroPagamentoAlunoHistoricoResultDTOSchema
>;

const formaPagamentoList = [
  'PIX',
  'BOLETO',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'DINHEIRO',
  'TRANSFERENCIA',
  'TED',
  'DOC',
  'DEBITO_AUTOMATICO',
  'CHEQUE',
  'VOUCHER',
  'OUTRO',
] as const;

const statusByTipo: Record<
  'RECEITA' | 'DESPESA',
  Array<'RECEBIDO' | 'PREVISTO' | 'PAGO' | 'PENDENTE' | 'ESTORNADO'>
> = {
  RECEITA: ['RECEBIDO', 'PREVISTO', 'ESTORNADO'],
  DESPESA: ['PAGO', 'PENDENTE', 'ESTORNADO'],
};

export const financeiroLancamentoInputDTOSchema = z
  .object({
    tipo: z.enum(['RECEITA', 'DESPESA']),
    origem: z.enum(['SISTEMA', 'MANUAL']).default('MANUAL'),
    status: z.enum(['RECEBIDO', 'PREVISTO', 'PAGO', 'PENDENTE', 'ESTORNADO']),
    valor: z.number().positive(),
    descricao: z.string().min(2).max(255),
    referencia: z.string().max(255).optional().nullable(),
    centroCustoId: z.string().min(1).optional().nullable(),
    categoriaId: z.string().min(1).optional().nullable(),
    subcategoriaId: z.string().min(1).optional().nullable(),
    formaPagamento: z.enum(formaPagamentoList).optional().nullable(),
    dataEfetiva: z.string().optional().nullable(),
    dataPrevista: z.string().optional().nullable(),
    observacao: z.string().max(2000).optional().nullable(),
    anexoUrl: z.string().max(1024).optional().nullable(),
    externalRef: z.string().max(255).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const allowed = statusByTipo[value.tipo];
    if (!allowed.includes(value.status)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Status nao permitido para o tipo selecionado',
        path: ['status'],
      });
    }

    const isEfetivo =
      value.status === 'RECEBIDO' || value.status === 'PAGO' || value.status === 'ESTORNADO';
    const isPrevisto = value.status === 'PREVISTO' || value.status === 'PENDENTE';

    if (isEfetivo && !value.dataEfetiva) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data efetiva obrigatoria para este status',
        path: ['dataEfetiva'],
      });
    }
    if (isPrevisto && !value.dataPrevista) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data prevista obrigatoria para status previsto/pendente',
        path: ['dataPrevista'],
      });
    }
  });

export type FinanceiroLancamentoInputDTO = z.input<typeof financeiroLancamentoInputDTOSchema>;

export const financeiroLancamentoEstornoInputDTOSchema = z.object({
  dataEstorno: z.string().optional(),
  motivo: z.string().max(500).optional(),
});

export type FinanceiroLancamentoEstornoInputDTO = z.infer<
  typeof financeiroLancamentoEstornoInputDTOSchema
>;

export const financeiroLancamentoDTOSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  origem: z.string(),
  status: z.string(),
  valor: z.number(),
  descricao: z.string(),
  referencia: z.string().nullable().optional(),
  centroCustoId: z.string().nullable().optional(),
  centroCustoNome: z.string().nullable().optional(),
  categoriaId: z.string().nullable().optional(),
  categoriaNome: z.string().nullable().optional(),
  subcategoriaId: z.string().nullable().optional(),
  subcategoriaNome: z.string().nullable().optional(),
  formaPagamento: z.string().nullable().optional(),
  dataEfetiva: z.string().nullable().optional(),
  dataPrevista: z.string().nullable().optional(),
  isEstorno: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  dataEstorno: z.string().nullable().optional(),
  motivoEstorno: z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
  anexoUrl: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  createdById: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  nomeCobranca: z.string().nullable().optional(),
  valorBruto: z.number().nullable().optional(),
  valorTaxa: z.number().nullable().optional(),
  valorLiquido: z.number().nullable().optional(),
});

export type FinanceiroLancamentoDTO = z.infer<typeof financeiroLancamentoDTOSchema>;

export const listFinanceiroLancamentosResultDTOSchema = z.object({
  data: z.array(financeiroLancamentoDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  totals: z.object({
    receitas: z.number(),
    despesas: z.number(),
    estornos: z.number(),
    liquido: z.number(),
  }),
});

export type ListFinanceiroLancamentosResultDTO = z.infer<typeof listFinanceiroLancamentosResultDTOSchema>;

export const financeiroLancamentoMutationResultDTOSchema = z.object({
  data: financeiroLancamentoDTOSchema,
});

export type FinanceiroLancamentoMutationResultDTO = z.infer<
  typeof financeiroLancamentoMutationResultDTOSchema
>;

export const financeiroLancamentoCategoriaQueryDTOSchema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA']).optional(),
});

export type FinanceiroLancamentoCategoriaQueryDTO = z.infer<
  typeof financeiroLancamentoCategoriaQueryDTOSchema
>;

export const financeiroLancamentoCategoriaInputDTOSchema = z.object({
  nome: z.string().min(2).max(100),
  tipo: z.enum(['RECEITA', 'DESPESA']),
  parentId: z.string().optional().nullable(),
});

export type FinanceiroLancamentoCategoriaInputDTO = z.infer<
  typeof financeiroLancamentoCategoriaInputDTOSchema
>;

export const financeiroLancamentoCategoriaDTOSchema = z
  .object({
    id: z.string(),
    contaId: z.string().optional(),
    nome: z.string(),
    tipo: z.string(),
    parentId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();

export type FinanceiroLancamentoCategoriaDTO = z.infer<
  typeof financeiroLancamentoCategoriaDTOSchema
>;

export const listFinanceiroLancamentoCategoriasResultDTOSchema = z.object({
  data: z.array(financeiroLancamentoCategoriaDTOSchema),
});

export type ListFinanceiroLancamentoCategoriasResultDTO = z.infer<
  typeof listFinanceiroLancamentoCategoriasResultDTOSchema
>;

export const financeiroLancamentoCategoriaMutationResultDTOSchema = z.object({
  data: financeiroLancamentoCategoriaDTOSchema,
});

export type FinanceiroLancamentoCategoriaMutationResultDTO = z.infer<
  typeof financeiroLancamentoCategoriaMutationResultDTOSchema
>;

export const financeiroLancamentoReciboResultDTOSchema = z.object({
  data: z.object({
    receiptUrl: z.string().nullable(),
    invoiceUrl: z.string().nullable(),
  }),
});

export type FinanceiroLancamentoReciboResultDTO = z.infer<
  typeof financeiroLancamentoReciboResultDTOSchema
>;
