import { z } from 'zod';

const familyAttemptSchema = z.object({
  contaId: z.string().min(1),
  uiRequestId: z.string().min(1),
  body: z.record(z.unknown()),
});
const familyResultsSchema = z.array(
  z.object({
    itemId: z.string().optional(),
    alunoId: z.string().min(1),
    alunoNome: z.string(),
    status: z.enum(['success', 'error']),
    matriculaId: z.string().optional(),
    contratoId: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
);

export type FamilyEnrollmentAttempt = z.infer<typeof familyAttemptSchema>;
const familyResponseSchema = z.object({
  data: z
    .object({
      state: z.string().optional(),
      operationId: z.string().optional(),
      familyId: z.string().optional(),
      operationStatus: z
        .enum([
          'PENDING',
          'PROCESSING',
          'COMPLETED',
          'PARTIAL',
          'FAILED',
          'REQUIRES_RECONCILIATION',
          'CANCELLED',
        ])
        .optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  results: z.unknown().optional(),
  familyId: z.string().optional(),
  operationId: z.string().optional(),
  operationStatus: z
    .enum([
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'REQUIRES_RECONCILIATION',
      'CANCELLED',
    ])
    .optional(),
  academicStatus: z.enum(['PENDENTE', 'COMPLETO', 'PARCIAL', 'FALHO', 'CANCELADO']).optional(),
  billingProvisionStatus: z
    .enum([
      'NAO_APLICAVEL',
      'PENDENTE',
      'PROCESSANDO',
      'PROVISIONADO',
      'PARCIAL',
      'FALHO',
      'RESULTADO_INCERTO',
      'CANCELADO',
    ])
    .optional(),
  paymentStatus: z.string().optional(),
  financialError: z.string().nullable().optional(),
});
const key = (contaId: string) =>
  `alusa:enrollment:family-attempt:v1:${encodeURIComponent(contaId)}`;

export function readFamilyEnrollmentAttempt(contaId: string): FamilyEnrollmentAttempt | null {
  const raw = globalThis.sessionStorage.getItem(key(contaId));
  if (!raw) return null;
  const attempt = familyAttemptSchema.parse(JSON.parse(raw));
  if (attempt.contaId !== contaId) throw new Error('A tentativa pendente pertence a outra conta.');
  return attempt;
}

export function saveFamilyEnrollmentAttempt(attempt: FamilyEnrollmentAttempt) {
  globalThis.sessionStorage.setItem(key(attempt.contaId), JSON.stringify(attempt));
}

export function clearFamilyEnrollmentAttempt(contaId: string) {
  globalThis.sessionStorage.removeItem(key(contaId));
}

export function parseFamilyEnrollmentResponse(value: unknown) {
  return familyResponseSchema.safeParse(value);
}

export function parseFamilyOperationDetails(value: unknown) {
  return z
    .object({
      operationId: z.string().optional(),
      familyId: z.string().optional(),
      operationStatus: z
        .enum([
          'PENDING',
          'PROCESSING',
          'COMPLETED',
          'PARTIAL',
          'FAILED',
          'REQUIRES_RECONCILIATION',
          'CANCELLED',
        ])
        .optional(),
    })
    .safeParse(value);
}

export function parseFamilyEnrollmentResults(value: unknown) {
  return familyResultsSchema.safeParse(value);
}

export function isSafelyRejectedFamilyIntent(code: string | undefined) {
  return Boolean(
    code &&
    new Set([
      'PAYLOAD_INVALIDO',
      'FORMA_PAGAMENTO_INVALIDA',
      'FORMA_PAGAMENTO_TAXA_INVALIDA',
      'PREVIEW_EXPIRADO',
      'PREVIEW_EXPIRACAO_INVALIDA',
      'PREVIEW_INCOMPATIVEL',
      'PREVIEW_DIVERGENTE',
      'DATA_FIM_INVALIDA',
      'RESPONSAVEL_NAO_ENCONTRADO',
      'ALUNO_NAO_ENCONTRADO',
      'ALUNO_NAO_VINCULADO_AO_RESPONSAVEL',
      'AGRUPAMENTO_FAMILIAR_INDISPONIVEL',
    ]).has(code),
  );
}
