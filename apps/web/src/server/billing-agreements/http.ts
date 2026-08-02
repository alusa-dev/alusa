import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import { getSessionUser, type SessionUser } from '@/lib/auth/session';

const BILLING_AGREEMENT_ROLES = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

export type BillingAgreementRequestContext = {
  contaId: string;
  actorId: string;
};

export function billingAgreementJsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export function billingAgreementValidationError(error: ZodError) {
  return billingAgreementJsonError(
    400,
    'PAYLOAD_INVALIDO',
    'Revise os dados informados antes de continuar.',
    error.issues,
  );
}

async function resolveBillingAgreementUser(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: billingAgreementJsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.'),
    };
  }

  if (!BILLING_AGREEMENT_ROLES.has(String(user.role).toUpperCase())) {
    return {
      ok: false,
      response: billingAgreementJsonError(
        403,
        'PERMISSAO_NEGADA',
        'Usuário não tem permissão para operar acordos financeiros de matrícula.',
      ),
    };
  }

  return { ok: true, user };
}

export async function withBillingAgreementRequest(
  handler: (_context: BillingAgreementRequestContext) => Promise<NextResponse>,
) {
  const auth = await resolveBillingAgreementUser();
  if (!auth.ok) return auth.response;

  // contaId vem exclusivamente da sessão e o contrato HTTP não aceita contaId.
  // O runtime financeiro abre transações tenant-scoped curtas; não mantemos uma
  // transação web aberta durante preflight ou mutações HTTP no Asaas.
  return handler({
    contaId: auth.user.contaId,
    actorId: auth.user.id,
  });
}

type SafeFinanceError = Error & {
  code?: string;
  statusCode?: number;
  details?: unknown;
};

const SAFE_STATUS_BY_CODE: Record<string, number> = {
  BILLING_AGREEMENT_NOT_FOUND: 404,
  AGREEMENT_NOT_FOUND: 404,
  TARGET_AGREEMENT_NOT_FOUND: 404,
  ALLOCATION_NOT_FOUND: 404,
  ENROLLMENT_NOT_FOUND: 404,
  INVALID_INPUT: 422,
  PREVIEW_EXPIRED: 409,
  PREVIEW_MISMATCH: 409,
  VERSION_CONFLICT: 409,
  AGREEMENT_VERSION_CONFLICT: 409,
  OPERATION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  OPERATION_BUSY: 409,
  REMOTE_STATE_DIVERGED: 409,
  LOCAL_COMMIT_CONFLICT: 409,
  PAYER_NOT_FOUND: 404,
  PAYER_CUSTOMER_NOT_PROVISIONED: 422,
  REMOTE_OPERATION_FAILED: 502,
  BILLING_CHANGE_BLOCKED: 422,
  INVALID_EFFECTIVE_POLICY: 422,
  INCOMPATIBLE_AGREEMENTS: 422,
  PAYMENT_ALREADY_SETTLED: 422,
};

const SAFE_DETAILS_CODES = new Set([
  'INVALID_INPUT',
  'PREVIEW_EXPIRED',
  'PREVIEW_MISMATCH',
  'AGREEMENT_VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'BILLING_CHANGE_BLOCKED',
  'INVALID_EFFECTIVE_POLICY',
  'INCOMPATIBLE_AGREEMENTS',
]);

export function billingAgreementUnexpectedError(error: unknown) {
  const financeError = error instanceof Error ? (error as SafeFinanceError) : null;
  const code = financeError?.code?.trim();
  if (code === 'TENANT_MISMATCH') {
    return billingAgreementJsonError(404, 'AGREEMENT_NOT_FOUND', 'Acordo financeiro não encontrado.');
  }
  const safeStatus = code ? SAFE_STATUS_BY_CODE[code] : undefined;

  if (code && safeStatus) {
    const remoteFailure = code === 'REMOTE_OPERATION_FAILED';
    return billingAgreementJsonError(
      safeStatus,
      code,
      remoteFailure
        ? 'A integração financeira rejeitou a alteração. Nenhuma nova tentativa deve ser feita antes da conferência.'
        : financeError?.message || 'A alteração financeira não pôde ser concluída.',
      SAFE_DETAILS_CODES.has(code) ? financeError?.details : undefined,
    );
  }

  console.error('[billing-agreements][http] unexpected error', {
    name: financeError?.name ?? 'UnknownError',
    code: code ?? null,
    message: financeError?.message ?? 'Unknown billing agreement error',
  });
  return billingAgreementJsonError(
    500,
    'ERRO_ACORDO_FINANCEIRO',
    'Não foi possível concluir a operação agora. Consulte a reconciliação antes de tentar novamente.',
  );
}
