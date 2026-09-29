import { z } from 'zod';

const alunoItemSchema = z.object({
  itemId: z.string().trim().min(1).max(120).optional(),
  alunoId: z.string().trim().min(1),
  turmaId: z.string().trim().min(1).optional(),
  comboId: z.string().trim().min(1).optional(),
});

const familyBillingStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SEPARATE') }),
  z.object({
    kind: z.literal('JOIN_EXISTING_CURRENT_CYCLE'),
    financialGroupId: z.string().trim().min(1),
    effectiveAt: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('SCHEDULE_NEXT_CYCLE_UNIFICATION'),
    financialGroupId: z.string().trim().min(1),
    effectiveAt: z.string().trim().min(1),
  }),
]);

export const createMatriculaFamiliarInputSchema = z.object({
  contaId: z.string().trim().min(1).optional(),
  responsavelId: z.string().trim().min(1),
  modoTurmas: z.enum(['COMBO', 'TURMAS']),
  planoId: z.string().trim().min(1).optional(),
  alunos: z
    .array(alunoItemSchema)
    .min(1, 'Informe ao menos uma matrícula para o agrupamento financeiro.'),
  descontoIds: z.array(z.string().trim().min(1)).optional().default([]),
  taxaMatricula: z.number().nonnegative().optional().default(0),
  taxaIsenta: z.boolean().optional().default(false),
  taxaJustificativa: z.string().trim().max(500).optional(),
  pagarTaxaAgora: z.boolean().optional().default(false),
  gerarCobrancaTaxa: z.boolean().optional().default(false),
  criarCobranca: z.boolean().optional().default(true),
  vencimentoDia: z.number().int().min(1).max(28),
  formaPagamento: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']),
  formaPagamentoTaxa: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).optional(),
  dataInicio: z.string().trim().min(1),
  dataFimContrato: z.string().trim().min(1),
  modeloId: z.string().trim().min(1, 'Modelo de contrato é obrigatório'),
  billingStrategy: familyBillingStrategySchema.default({ kind: 'SEPARATE' }),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/i),
  previewExpiresAt: z.string().trim().min(1),
  multaPercentual: z.number().nonnegative().optional(),
  jurosMensal: z.number().nonnegative().optional(),
  descontoAntecipado: z.number().nonnegative().optional(),
  descontoTipo: z.enum(['FIXED', 'PERCENTAGE']).optional(),
  prazoDesconto: z.number().int().nonnegative().optional(),
  notificationChannels: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))
    .optional()
    .default([]),
  notificationChannelsConfigured: z.boolean().optional().default(false),
  uiRequestId: z.string().trim().min(1).max(120),
});

export type CreateMatriculaFamiliarBody = z.infer<
  typeof createMatriculaFamiliarInputSchema
>;

