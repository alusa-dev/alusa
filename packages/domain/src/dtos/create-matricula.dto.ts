import { z } from 'zod';
import { createAlunoDTOSchema } from './aluno.dto.js';
import { createResponsavelDTOSchema } from './responsavel.dto.js';

/**
 * CreateMatriculaDTO — Contrato formal para criação de matrícula
 * ADR: Wizard de Matrícula com Contrato Formal
 * 
 * Princípios:
 * - Frontend envia intenção clara, backend valida e decide
 * - Nenhuma matrícula é criada sem payerResolved === true
 * - Estados intermediários são explícitos
 */

// Formas de pagamento suportadas
export const formaPagamentoSchema = z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO', 'INDEFINIDO']);
export type FormaPagamento = z.infer<typeof formaPagamentoSchema>;

// Configurações financeiras
export const configuracoesFinanceirasSchema = z.object({
  // Dia do vencimento (1-28)
  vencimentoDia: z.number().int().min(1).max(28).default(5),
  // Juros ao mês (percentual)
  jurosMensal: z.number().min(0).max(10).optional().nullable(),
  jurosTipo: z.enum(['FIXED', 'PERCENTAGE']).default('PERCENTAGE'),
  // Multa por atraso (percentual)
  multaPercentual: z.number().min(0).max(20).optional().nullable(),
  multaTipo: z.enum(['FIXED', 'PERCENTAGE']).default('PERCENTAGE'),
  // Desconto por antecipação
  descontoAntecipado: z.number().min(0).max(100).optional().nullable(),
  descontoTipo: z.enum(['FIXED', 'PERCENTAGE']).default('PERCENTAGE'),
  prazoDesconto: z.number().int().min(0).max(30).default(0),
});

export type ConfiguracoesFinanceirasDTO = z.infer<typeof configuracoesFinanceirasSchema>;

// Taxa de matrícula
export const taxaMatriculaSchema = z.object({
  valor: z.number().min(0),
  isenta: z.boolean().default(false),
  justificativa: z.string().optional().nullable(),
  formaPagamento: formaPagamentoSchema.default('BOLETO'),
});

export type TaxaMatriculaDTO = z.infer<typeof taxaMatriculaSchema>;

// Dados do plano/combo
export const planoMatriculaSchema = z.object({
  planoId: z.string().optional().nullable(),
  comboId: z.string().optional().nullable(),
  turmaId: z.string().optional().nullable(),
  turmaIds: z.array(z.string()).optional().nullable(),
}).refine(
  (data) => data.planoId || data.comboId,
  { message: 'Plano ou combo é obrigatório' }
);

export type PlanoMatriculaDTO = z.infer<typeof planoMatriculaSchema>;

// DTO principal de criação de matrícula
export const createMatriculaDTOSchema = z.object({
  contaId: z.string().min(1, 'ID da conta é obrigatório'),
  
  // Aluno: pode ser existente (id) ou novo (dados completos)
  aluno: z.union([
    z.object({ id: z.string().min(1) }),
    createAlunoDTOSchema,
  ]),
  
  // Responsável: obrigatório para menores
  responsavel: z.union([
    z.object({ id: z.string().min(1) }),
    createResponsavelDTOSchema,
  ]).optional().nullable(),
  
  // Flag explícita: o frontend confirma que o pagador foi resolvido
  payerResolved: z.boolean().default(false),
  
  // Plano/combo e turmas
  plano: planoMatriculaSchema,
  
  // Datas
  dataInicio: z.coerce.date(),
  dataFimContrato: z.coerce.date(),
  
  // Taxa de matrícula
  taxa: taxaMatriculaSchema,
  
  // Configurações financeiras
  configFinanceiras: configuracoesFinanceirasSchema.optional(),
  
  // Descontos aplicados
  descontoIds: z.array(z.string()).optional().nullable(),
});

export type CreateMatriculaDTO = z.infer<typeof createMatriculaDTOSchema>;

/**
 * Validação refinada com regras de negócio
 */
export const createMatriculaWithRulesSchema = createMatriculaDTOSchema.superRefine((data, ctx) => {
  // Regra: payerResolved deve ser true para criar matrícula
  if (!data.payerResolved) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Pagador não foi resolvido. Complete a etapa de definição do pagador.',
      path: ['payerResolved'],
    });
  }
  
  // Regra: dataFimContrato deve ser posterior a dataInicio
  if (data.dataFimContrato <= data.dataInicio) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Data de fim do contrato deve ser posterior à data de início',
      path: ['dataFimContrato'],
    });
  }
  
  // Regra: se taxa não é isenta, deve ter valor > 0
  if (!data.taxa.isenta && data.taxa.valor <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Taxa de matrícula deve ser maior que zero ou marcada como isenta',
      path: ['taxa', 'valor'],
    });
  }
  
  // Regra: se taxa isenta, justificativa é obrigatória
  if (data.taxa.isenta && !data.taxa.justificativa?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Justificativa é obrigatória para isenção de taxa',
      path: ['taxa', 'justificativa'],
    });
  }
});

export type CreateMatriculaWithRulesDTO = z.infer<typeof createMatriculaWithRulesSchema>;

/**
 * DTO de resultado da criação
 */
export const createMatriculaResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    matriculaId: z.string(),
    status: z.enum(['PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO', 'ATIVA']),
    financeStatus: z.enum(['PENDENTE_TAXA', 'ADIMPLENTE', 'INADIMPLENTE', 'PENDENTE_FINANCEIRO']),
    contratoId: z.string().optional().nullable(),
    payerId: z.string(),
    payerType: z.enum(['ALUNO', 'RESPONSAVEL']),
    asaasCustomerId: z.string().optional().nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    code: z.enum([
      'VALIDACAO_FALHOU',
      'PAYER_NAO_RESOLVIDO',
      'RESPONSAVEL_OBRIGATORIO',
      'PLANO_NAO_ENCONTRADO',
      'ALUNO_NAO_ENCONTRADO',
      'CONTA_NAO_ENCONTRADA',
      'ASAAS_ERRO',
      'ERRO_INTERNO',
    ]),
    details: z.record(z.unknown()).optional(),
  }),
]);

export type CreateMatriculaResultDTO = z.infer<typeof createMatriculaResultSchema>;
