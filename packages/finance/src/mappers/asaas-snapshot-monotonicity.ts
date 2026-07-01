import type { ChargeStatus, StatusCobranca } from '@prisma/client';

import type { AsaasPaymentStatus } from './asaas-display-status';
import { isAsaasPaymentStatus } from './asaas-display-status';

const PAID_LIKE_ASAAS_STATUSES = new Set<string>([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

const OPEN_LIKE_ASAAS_STATUSES = new Set<string>(['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS']);

/**
 * Precedência do status bruto do Asaas para snapshot local.
 * Valores maiores = estados mais avançados. Refunds/chargebacks/deleted são terminais.
 */
const ASAAS_PAYMENT_STATUS_PRECEDENCE: Record<string, number> = {
  PENDING: 10,
  AWAITING_RISK_ANALYSIS: 15,
  OVERDUE: 20,
  CONFIRMED: 40,
  RECEIVED: 45,
  RECEIVED_IN_CASH: 45,
  DUNNING_RECEIVED: 45,
  REFUND_REQUESTED: 80,
  REFUND_IN_PROGRESS: 82,
  CHARGEBACK_REQUESTED: 84,
  CHARGEBACK_DISPUTE: 86,
  AWAITING_CHARGEBACK_REVERSAL: 87,
  DUNNING_REQUESTED: 88,
  REFUNDED: 90,
  DELETED: 95,
};

export type ResolveMonotonicAsaasPaymentStatusInput = {
  currentAsaasStatus?: string | null;
  incoming?: string | null;
  localChargeStatus?: ChargeStatus | string | null;
  localCobrancaStatus?: StatusCobranca | string | null;
};

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getAsaasStatusRank(status: string): number {
  return ASAAS_PAYMENT_STATUS_PRECEDENCE[status] ?? 0;
}

export function isLocalPaymentSettled(
  localChargeStatus?: ChargeStatus | string | null,
  localCobrancaStatus?: StatusCobranca | string | null,
): boolean {
  const chargeStatus = normalize(localChargeStatus);
  const cobrancaStatus = normalize(localCobrancaStatus);
  return chargeStatus === 'PAID' || cobrancaStatus === 'PAGO';
}

export function isStaleAsaasStatusForSettledLocal(params: {
  asaasStatus?: string | null;
  localChargeStatus?: ChargeStatus | string | null;
  localCobrancaStatus?: StatusCobranca | string | null;
  hasAsaasLink?: boolean;
}): boolean {
  if (!params.hasAsaasLink) return false;
  if (!isLocalPaymentSettled(params.localChargeStatus, params.localCobrancaStatus)) {
    return false;
  }

  const asaasStatus = normalize(params.asaasStatus);
  if (!isAsaasPaymentStatus(asaasStatus)) return false;

  return OPEN_LIKE_ASAAS_STATUSES.has(asaasStatus);
}

export function hasAsaasSnapshotDrift(params: {
  asaasStatus?: string | null;
  localChargeStatus?: ChargeStatus | string | null;
  localCobrancaStatus?: StatusCobranca | string | null;
}): boolean {
  return isStaleAsaasStatusForSettledLocal({
    ...params,
    hasAsaasLink: true,
  });
}

export function resolveMonotonicAsaasPaymentStatus(
  params: ResolveMonotonicAsaasPaymentStatusInput,
): string | null {
  const incoming = normalize(params.incoming);
  const current = normalize(params.currentAsaasStatus);

  if (!incoming) return current || null;
  if (!current) return incoming;

  const incomingRank = getAsaasStatusRank(incoming);
  const currentRank = getAsaasStatusRank(current);

  // Terminais negativos (estorno/chargeback/remoção) podem avançar mesmo após pagamento.
  if (incomingRank >= 80) {
    return incomingRank >= currentRank ? incoming : current;
  }

  const localPaymentSettled = isLocalPaymentSettled(
    params.localChargeStatus,
    params.localCobrancaStatus,
  );

  if (localPaymentSettled) {
    if (PAID_LIKE_ASAAS_STATUSES.has(current) && incomingRank < currentRank) {
      return current;
    }
    if (PAID_LIKE_ASAAS_STATUSES.has(current) && OPEN_LIKE_ASAAS_STATUSES.has(incoming)) {
      return current;
    }
  }

  if (
    !localPaymentSettled &&
    PAID_LIKE_ASAAS_STATUSES.has(current) &&
    OPEN_LIKE_ASAAS_STATUSES.has(incoming)
  ) {
    return incoming;
  }

  if (currentRank >= 40 && incomingRank < currentRank) {
    return current;
  }

  return incomingRank >= currentRank ? incoming : current;
}

export function isPaidLikeAsaasStatus(status: string | null | undefined): status is AsaasPaymentStatus {
  return PAID_LIKE_ASAAS_STATUSES.has(normalize(status));
}
