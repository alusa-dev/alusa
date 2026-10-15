/**
 * Resolver canônico de liquidação a partir do status Asaas.
 * Usado por webhooks, reconcile e APIs — evita drift entre caminhos.
 */
import type { LiquidacaoStatus } from '@prisma/client';
import { parsePaymentDate } from '@alusa/shared';

export type ResolveLiquidacaoFromAsaasInput = {
  asaasStatus: string | null | undefined;
  creditDate?: Date | string | null;
  billingType?: string | null;
  referenceDate?: Date;
};

function normalizeCreditDateDay(creditDate?: Date | string | null): string | null {
  if (!creditDate) return null;

  if (typeof creditDate === 'string') {
    try {
      const parsed = parsePaymentDate(creditDate);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    } catch {
      return null;
    }
  }

  if (Number.isNaN(creditDate.getTime())) return null;
  return creditDate.toISOString().slice(0, 10);
}

const PAID_ASAAS_STATUSES = new Set(['RECEIVED', 'CONFIRMED']);

/**
 * Calcula liquidacaoStatus com base no payment Asaas.
 *
 * RECEIVED_IN_CASH → DISPONIVEL (quitado operacionalmente; saldo Asaas exclui via asaasStatus).
 * RECEIVED / CONFIRMED → PENDENTE ou DISPONIVEL conforme creditDate vs hoje.
 */
export function resolveLiquidacaoFromAsaasPayment(
  input: ResolveLiquidacaoFromAsaasInput,
): LiquidacaoStatus {
  const normalizedStatus = (input.asaasStatus ?? '').trim().toUpperCase();
  const billingType = (input.billingType ?? '').trim().toUpperCase();
  const referenceDate = input.referenceDate ?? new Date();
  const today = referenceDate.toISOString().slice(0, 10);
  const creditDay = normalizeCreditDateDay(input.creditDate);

  if (normalizedStatus === 'RECEIVED_IN_CASH' || billingType === 'RECEIVED_IN_CASH') {
    return 'DISPONIVEL';
  }

  if (PAID_ASAAS_STATUSES.has(normalizedStatus)) {
    if (!creditDay) return 'PENDENTE';
    return creditDay <= today ? 'DISPONIVEL' : 'PENDENTE';
  }

  return 'NAO_APLICAVEL';
}
