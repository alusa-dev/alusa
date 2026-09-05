import { z } from 'zod';
import { createMatriculaResultDTOSchema } from '../dtos';

const attemptSchema = z.object({ contaId: z.string(), uiRequestId: z.string(), body: z.string() });
export type EnrollmentAttempt = z.infer<typeof attemptSchema>;
export type EnrollmentConfirmationState = 'IDLE' | 'CONFIRMING' | 'UNCERTAIN' | 'REQUIRES_RECONCILIATION' | 'COMPENSATED';

const statusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('COMMITTED'), result: createMatriculaResultDTOSchema }),
  z.object({ status: z.enum(['NOT_FOUND', 'PROCESSING', 'REQUIRES_RECONCILIATION', 'COMPENSATED']) }),
]);
const key = (contaId: string) => `alusa:enrollment-attempt:${contaId}`;

export function readEnrollmentAttempt(contaId: string): EnrollmentAttempt | null {
  const raw = sessionStorage.getItem(key(contaId));
  if (!raw) return null;
  // An unreadable pending intent must not silently allow another financial creation.
  const attempt = attemptSchema.parse(JSON.parse(raw));
  if (attempt.contaId !== contaId) throw new Error('A confirmação pendente pertence a outra conta.');
  return attempt;
}

export function saveEnrollmentAttempt(attempt: EnrollmentAttempt) {
  sessionStorage.setItem(key(attempt.contaId), JSON.stringify(attempt));
}

export function clearEnrollmentAttempt(contaId: string) {
  sessionStorage.removeItem(key(contaId));
}

export async function readEnrollmentAttemptStatus(attempt: EnrollmentAttempt) {
  const response = await fetch(
    `/api/matriculas/operacoes/${encodeURIComponent(attempt.uiRequestId)}?contaId=${encodeURIComponent(attempt.contaId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Não foi possível consultar a tentativa. Consulte novamente antes de criar outra matrícula.');
  return statusSchema.parse(await response.json());
}

export class EnrollmentSubmissionError extends Error {
  readonly code: string | undefined;
  readonly safelyRejected: boolean;

  constructor(code: string | undefined, message: string, safelyRejected: boolean) {
    super(message);
    this.code = code;
    this.safelyRejected = safelyRejected;
  }
}

// These responses occur before the creation use-case can start any remote operation.
const preflightRejections = new Set([
  'PAYLOAD_INVALIDO', 'CONTA_INVALIDA', 'CONTA_SESSAO_OBRIGATORIA', 'CONTA_OBRIGATORIA',
  'USUARIO_NAO_AUTENTICADO', 'PAPEL_USUARIO_NAO_DEFINIDO', 'PERMISSAO_NEGADA',
  'FORMA_PAGAMENTO_INVALIDA', 'FORMA_PAGAMENTO_TAXA_INVALIDA', 'PREVIEW_EXPIRADO',
  'PREVIEW_EXPIRACAO_INVALIDA', 'DATA_FIM_INVALIDA', 'DATA_FIM_CONTRATO_OBRIGATORIA',
  'ASSINATURA_OBRIGATORIA_PARA_MATRICULA_FINANCEIRA',
]);

export async function sendEnrollmentAttempt(attempt: EnrollmentAttempt) {
  const response = await fetch('/api/matriculas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: attempt.body,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = z.object({ error: z.object({ code: z.string().optional(), message: z.string() }) }).safeParse(body);
    const code = error.success ? error.data.error.code : undefined;
    throw new EnrollmentSubmissionError(
      code,
      error.success ? error.data.error.message : 'A confirmação não foi concluída. Consulte o resultado da tentativa.',
      Boolean(code && preflightRejections.has(code) && response.status < 500),
    );
  }
  return createMatriculaResultDTOSchema.parse(await response.json());
}
