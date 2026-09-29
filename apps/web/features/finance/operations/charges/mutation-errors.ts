import { NextResponse } from 'next/server';
import type { PaymentActionDecision } from '@alusa/finance';

const ASAAS_PAID_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

function mutationError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      success: false,
      code,
      error: message,
      ...extra,
    },
    { status },
  );
}

function editBlockedError(params: { status: string; source: 'LOCAL' | 'ASAAS' }) {
  const isPaid = params.source === 'ASAAS'
    ? ASAAS_PAID_PAYMENT_STATUSES.has(params.status)
    : params.status === 'PAID' || params.status === 'PAGO';

  return mutationError(
    isPaid ? 409 : 400,
    isPaid ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE' : 'EDIT_NOT_ALLOWED_FOR_CHARGE_STATUS',
    params.source === 'ASAAS'
      ? `Não é possível editar cobrança com status ${params.status} no Asaas`
      : `Não é possível editar cobrança com status ${params.status}`,
    params.source === 'ASAAS'
      ? { asaasStatus: params.status }
      : { status: params.status },
  );
}

function cancelBlockedError(params: { status: string; source: 'LOCAL' | 'ASAAS' }) {
  const isPaid = params.source === 'ASAAS'
    ? ASAAS_PAID_PAYMENT_STATUSES.has(params.status)
    : params.status === 'PAID' || params.status === 'PAGO';

  return mutationError(
    isPaid ? 409 : 400,
    isPaid ? 'CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE' : 'CANCEL_NOT_ALLOWED_FOR_CHARGE_STATUS',
    params.source === 'ASAAS'
      ? `Cobrança paga no Asaas (${params.status}). Não é possível cancelar.`
      : `Não é possível cancelar cobrança com status ${params.status}.`,
    params.source === 'ASAAS'
      ? { asaasStatus: params.status }
      : { status: params.status },
  );
}

export function policyBlockedError(params: {
  action: 'EDIT' | 'CANCEL';
  decision: PaymentActionDecision;
  status?: string | null;
  source?: 'LOCAL' | 'ASAAS';
}) {
  const fallback = params.action === 'EDIT'
    ? editBlockedError({ status: params.status ?? 'DESCONHECIDO', source: params.source ?? 'LOCAL' })
    : cancelBlockedError({ status: params.status ?? 'DESCONHECIDO', source: params.source ?? 'LOCAL' });

  if (!params.decision.code || !params.decision.reason) {
    return fallback;
  }

  const isPaidBlock =
    params.decision.code.includes('PAID') ||
    params.status === 'RECEIVED' ||
    params.status === 'CONFIRMED' ||
    params.status === 'RECEIVED_IN_CASH' ||
    params.status === 'PAGO' ||
    params.status === 'PAID';

  return mutationError(
    isPaidBlock ? 409 : 400,
    isPaidBlock
      ? params.action === 'EDIT'
        ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE'
        : 'CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE'
      : params.decision.code,
    params.decision.reason,
    {
      ...(params.source === 'ASAAS' ? { asaasStatus: params.status } : { status: params.status }),
      ...(params.decision.hint ? { hint: params.decision.hint } : {}),
    },
  );
}
