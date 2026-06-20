import { z } from 'zod';

function emptyToUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function emptyToNull(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === 'null')) return null;
  return value;
}

function coerceOptionalNumber(value: unknown) {
  const normalized = emptyToUndefined(value);
  if (normalized === undefined) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coerceBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

export const rematriculaFamiliarDecisionSchema = z.enum([
  'REMATRICULAR_AGORA',
  'NAO_CONTINUARA',
  'DECIDIR_DEPOIS',
  'TRANSFERIR_MODALIDADE',
  'ALTERAR_PAGADOR',
  'REMATRICULAR_SEPARADAMENTE',
]);

export const rematriculaFamiliarItemSchema = z.object({
  matriculaId: z.string().trim().min(1),
  decision: rematriculaFamiliarDecisionSchema.default('DECIDIR_DEPOIS'),
  turmaId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  planoId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  comboId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  decisionReason: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
});

const paymentMethodSchema = z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']);

const rematriculaFamiliarBaseSchema = z.object({
  contaId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  campaignId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  targetPeriodId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  responsavelId: z.string().trim().min(1),
  itens: z.array(rematriculaFamiliarItemSchema).min(1),
  dataInicio: z.string().trim().min(1),
  dataFimContrato: z.string().trim().min(1),
  formaPagamento: paymentMethodSchema,
  formaPagamentoTaxa: z.preprocess(emptyToUndefined, paymentMethodSchema.optional()),
  vencimentoDia: z.preprocess(
    (value) => {
      const parsed = coerceOptionalNumber(value);
      if (parsed === undefined) return 5;
      return Math.min(28, Math.max(1, Math.trunc(parsed)));
    },
    z.number().int().min(1).max(28),
  ),
  taxaMatricula: z.preprocess(
    (value) => coerceOptionalNumber(value) ?? 0,
    z.number().nonnegative(),
  ),
  taxaIsenta: z.preprocess((value) => coerceBoolean(value, false), z.boolean()).default(false),
  taxaJustificativa: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  descontos: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        cumulativo: z.boolean().optional(),
      }),
    )
    .optional()
    .default([]),
  multaPercentual: z.preprocess(coerceOptionalNumber, z.number().nonnegative().optional()),
  jurosMensal: z.preprocess(coerceOptionalNumber, z.number().nonnegative().optional()),
  descontoAntecipado: z.preprocess(coerceOptionalNumber, z.number().nonnegative().optional()),
  prazoDesconto: z.preprocess(coerceOptionalNumber, z.number().int().nonnegative().optional()),
  overrideReason: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  notificationChannels: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))
    .optional()
    .default([]),
  notificationChannelsConfigured: z.preprocess(
    (value) => coerceBoolean(value, false),
    z.boolean(),
  ).default(false),
  contratoModeloId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  uiRequestId: z.string().trim().min(1).max(120),
});

export const rematriculaFamiliarPreviewInputSchema = rematriculaFamiliarBaseSchema;

export const rematriculaFamiliarCommitInputSchema = rematriculaFamiliarBaseSchema.extend({
  previewId: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
  previewHash: z.preprocess(emptyToNull, z.string().trim().min(1).nullable().optional()),
});

export function formatRematriculaFamiliarValidationMessage(issues: z.ZodIssue[]): string {
  const issue = issues[0];
  if (!issue) return 'Revise os dados da rematrícula familiar e tente novamente.';

  const path = issue.path.join('.');
  if (path === 'uiRequestId' || path.endsWith('.uiRequestId')) {
    return 'Não foi possível identificar esta solicitação. Feche o formulário e abra novamente.';
  }
  if (path.includes('decision')) {
    return 'Defina a decisão de rematrícula para cada aluno vinculado.';
  }
  if (path === 'contratoModeloId') {
    return 'Selecione um modelo de contrato ativo antes de confirmar.';
  }
  if (path === 'responsavelId') {
    return 'Responsável financeiro inválido para esta rematrícula.';
  }
  if (path === 'vencimentoDia') {
    return 'Informe um dia de vencimento entre 1 e 28.';
  }
  if (path === 'dataInicio' || path === 'dataFimContrato') {
    return 'Informe datas de início e fim do contrato válidas.';
  }
  if (path.includes('turmaId')) {
    return 'Para alunos com “Rematricular agora”, selecione a turma do novo ciclo.';
  }
  if (path.includes('planoId') || path.includes('comboId')) {
    return 'Selecione o plano ou combo do novo ciclo.';
  }
  if (path === 'formaPagamento' || path === 'formaPagamentoTaxa') {
    return 'Selecione uma forma de pagamento válida.';
  }
  if (path.includes('taxaMatricula')) {
    return 'Informe um valor válido para a taxa de rematrícula ou marque a isenção.';
  }

  return 'Revise os dados da rematrícula familiar e tente novamente.';
}

export function parseRematriculaFamiliarDate(value: string) {
  const normalized = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00.000Z`)
    : new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida.');
  return date;
}

export function isRematriculaFamiliarPreviewBusinessError(message: string) {
  return (
    message.includes('matrículas familiares') ||
    message.includes('decisão explícita') ||
    message.includes('composição familiar')
  );
}
