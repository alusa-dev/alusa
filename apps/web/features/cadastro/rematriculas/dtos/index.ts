import { z } from 'zod';

export const rematriculaStatusContratoDTOSchema = z.enum([
  'AGUARDANDO_ASSINATURA',
  'ATIVO',
  'EXPIRADO',
  'CANCELADO',
]);

export type RematriculaStatusContratoDTO = z.infer<typeof rematriculaStatusContratoDTOSchema>;

export const rematriculaFormaPagamentoDTOSchema = z.enum([
  'BOLETO',
  'PIX',
  'CARTAO_CREDITO',
  'INDEFINIDO',
]);

export type RematriculaFormaPagamentoDTO = z.infer<typeof rematriculaFormaPagamentoDTOSchema>;

export const rematriculaEligibilityStatusDTOSchema = z.enum(['ELEGIVEL', 'NAO_ELEGIVEL']);

export const rematriculaFinancialStatusDTOSchema = z.enum([
  'REGULAR',
  'PENDENTE',
  'ATRASADO',
  'MULTIPLAS_COBRANCAS_EM_ABERTO',
  'DESCONHECIDO',
]);

export const rematriculaActionStatusDTOSchema = z.enum([
  'LIBERADA',
  'LIBERADA_COM_AVISO',
  'REQUER_OVERRIDE',
  'BLOQUEADA',
]);

export const rematriculaBlockReasonDTOSchema = z.enum([
  'SEM_BLOQUEIO',
  'COBRANCA_EM_ABERTO',
  'COBRANCA_ATRASADA',
  'MULTIPLAS_COBRANCAS',
  'AGUARDANDO_RECONCILIACAO',
  'POLITICA_DA_ESCOLA',
  'OUTRO',
]);

export const rematriculaAlunoDTOSchema = z.object({
  id: z.string(),
  nome: z.string().nullable(),
  cpf: z.string().nullable(),
  foto: z.string().nullable().optional(),
});

export type RematriculaAlunoDTO = z.infer<typeof rematriculaAlunoDTOSchema>;

export const rematriculaResponsavelDTOSchema = z.object({
  id: z.string(),
  nome: z.string().nullable(),
  cpf: z.string().nullable(),
  email: z.string().nullable().optional(),
  telefone: z.string().nullable().optional(),
  foto: z.string().nullable().optional(),
});

export type RematriculaResponsavelDTO = z.infer<typeof rematriculaResponsavelDTOSchema>;

export const rematriculaPlanoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
});

export type RematriculaPlanoDTO = z.infer<typeof rematriculaPlanoDTOSchema>;

export const rematriculaTurmaDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  diasSemana: z.array(z.string()),
  horaInicio: z.string(),
  horaFim: z.string(),
});

export type RematriculaTurmaDTO = z.infer<typeof rematriculaTurmaDTOSchema>;

export const rematriculaComboDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
});

export type RematriculaComboDTO = z.infer<typeof rematriculaComboDTOSchema>;

export const rematriculaDescontoResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
});

export type RematriculaDescontoResumoDTO = z.infer<typeof rematriculaDescontoResumoDTOSchema>;

export const rematriculaFinanceiroDTOSchema = z.object({
  pendencias: z.number().int().nonnegative().default(0),
  cobrancasEmAberto: z.number().int().nonnegative().default(0),
  cobrancasAtrasadas: z.number().int().nonnegative().default(0),
  financialStatus: rematriculaFinancialStatusDTOSchema.default('REGULAR'),
  rematriculaActionStatus: rematriculaActionStatusDTOSchema.default('LIBERADA'),
  blockReason: rematriculaBlockReasonDTOSchema.default('SEM_BLOQUEIO'),
  actionMessage: z.string().default(''),
  canCurrentUserOverride: z.boolean().default(false),
  requiresOverrideReason: z.boolean().default(true),
  shouldBlockNewFinancialCycle: z.boolean().default(false),
  formaPagamento: rematriculaFormaPagamentoDTOSchema.nullable(),
  formaPagamentoTaxa: rematriculaFormaPagamentoDTOSchema.nullable(),
  vencimentoDia: z.number().int().nullable(),
  taxaMatricula: z.number().nullable(),
  taxaIsenta: z.boolean(),
  taxaJustificativa: z.string().nullable(),
  multaPercentual: z.number().nullable(),
  jurosMensal: z.number().nullable(),
  descontoAntecipado: z.number().nullable(),
  prazoDesconto: z.number().nullable(),
  diasTolerancia: z.number().nullable(),
  descontos: z.array(rematriculaDescontoResumoDTOSchema),
});

export type RematriculaFinanceiroDTO = z.infer<typeof rematriculaFinanceiroDTOSchema>;

export const rematriculaItemDTOSchema = z.object({
  id: z.string(),
  matriculaFamiliarId: z.string().nullable().optional(),
  status: z.enum([
    'PENDENTE_TAXA',
    'AGUARDANDO_CONFIRMACAO',
    'ATIVA',
    'PAUSADA',
    'RECUSADA',
    'CANCELADA',
  ]),
  statusContrato: rematriculaStatusContratoDTOSchema,
  dataInicio: z.string(),
  dataFimContrato: z.string(),
  diasRestantes: z.number().int(),
  contratoExpirado: z.boolean(),
  podeRenovar: z.boolean(),
  eligibilityStatus: rematriculaEligibilityStatusDTOSchema.default('ELEGIVEL'),
  aluno: rematriculaAlunoDTOSchema,
  responsavelFinanceiro: rematriculaResponsavelDTOSchema.nullable().optional(),
  plano: rematriculaPlanoDTOSchema,
  turma: rematriculaTurmaDTOSchema.nullable(),
  combo: rematriculaComboDTOSchema.nullable(),
  financeiro: rematriculaFinanceiroDTOSchema,
});

export type RematriculaItemDTO = z.infer<typeof rematriculaItemDTOSchema>;

export const listRematriculasQueryDTOSchema = z.object({
  contaId: z.string().trim().optional(),
  diasAntecedencia: z.number().int().positive().default(60),
  referencia: z.string().optional(),
  statusContrato: rematriculaStatusContratoDTOSchema.optional(),
  q: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

export type ListRematriculasQueryDTO = z.infer<typeof listRematriculasQueryDTOSchema>;

export const listRematriculasResultDTOSchema = z.object({
  referencia: z.string(),
  ate: z.string(),
  total: z.number().int().nonnegative(),
  itens: z.array(rematriculaItemDTOSchema),
});

export type ListRematriculasResultDTO = z.infer<typeof listRematriculasResultDTOSchema>;

export const createRematriculaInputDTOSchema = z.object({
  contaId: z.string().trim().optional(),
  matriculaId: z.string().trim().min(1),
  dataInicio: z.union([z.string(), z.date()]).optional(),
  dataFimContrato: z.union([z.string(), z.date()]),
  planoId: z.string().trim().optional(),
  turmaId: z.string().trim().nullable().optional(),
  comboId: z.string().trim().nullable().optional(),
  responsavelFinanceiroId: z.string().trim().nullable().optional(),
  formaPagamento: rematriculaFormaPagamentoDTOSchema.optional(),
  formaPagamentoTaxa: rematriculaFormaPagamentoDTOSchema.optional(),
  vencimentoDia: z.union([z.number(), z.string()]).optional(),
  billingMode: z.enum(['INDIVIDUAL', 'SHARED_PLAN']).optional(),
  valorMensalidadeOverride: z.union([z.number(), z.string()]).optional(),
  taxaMatricula: z.union([z.number(), z.string()]).optional(),
  taxaIsenta: z.union([z.boolean(), z.string()]).optional(),
  taxaJustificativa: z.string().trim().optional(),
  criarCobranca: z.union([z.boolean(), z.string()]).optional(),
  descontos: z
    .array(
      z.object({
        id: z.string(),
        cumulativo: z.boolean().optional(),
      }),
    )
    .optional(),
  multaPercentual: z.union([z.number(), z.string()]).optional(),
  jurosMensal: z.union([z.number(), z.string()]).optional(),
  diasTolerancia: z.union([z.number(), z.string()]).optional(),
  descontoAntecipado: z.union([z.number(), z.string()]).optional(),
  prazoDesconto: z.union([z.number(), z.string()]).optional(),
  overrideReason: z.string().trim().optional(),
});

export type CreateRematriculaInputDTO = z.input<typeof createRematriculaInputDTOSchema>;

export const createRematriculaResultDTOSchema = z.object({
  operationId: z.string(),
  status: z.enum(['PENDING', 'PENDING_FINANCE', 'COMMITTED']),
  matriculaId: z.string(),
  message: z.string(),
  novaMatricula: z.object({
    id: z.string(),
    planoId: z.string(),
    turmaId: z.string().nullable(),
    status: z.enum([
      'PENDENTE_TAXA',
      'AGUARDANDO_CONFIRMACAO',
      'ATIVA',
      'PAUSADA',
      'RECUSADA',
      'CANCELADA',
    ]),
    statusContrato: rematriculaStatusContratoDTOSchema,
    dataInicio: z.string(),
    dataFimContrato: z.string(),
    asaasSubscriptionId: z.string().nullable(),
  }),
  historicoContrato: z.object({
    dataInicioAnterior: z.string(),
    dataFimContratoAnterior: z.string(),
    turmaIdAnterior: z.string().nullable(),
    planoIdAnterior: z.string(),
  }),
  primeiroVencimento: z.string(),
  responsavelFinanceiro: rematriculaAlunoDTOSchema.nullable(),
});

export type CreateRematriculaResultDTO = z.infer<typeof createRematriculaResultDTOSchema>;
