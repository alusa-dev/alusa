/**
 * Literais técnicos de status de payment do Asaas.
 * Tipo bruto canônico: PaymentStatus em @alusa/asaas.
 */

import type { PaymentStatus } from '@alusa/asaas';

/**
 * @deprecated Use `PaymentStatus` de `@alusa/asaas`.
 */
export type AsaasPaymentStatus = PaymentStatus;

export const ASAAS_PAYMENT_STATUS = {
  PENDING: 'PENDING',
  RECEIVED: 'RECEIVED',
  CONFIRMED: 'CONFIRMED',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
  RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
  CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
  CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
  AWAITING_CHARGEBACK_REVERSAL: 'AWAITING_CHARGEBACK_REVERSAL',
  DUNNING_REQUESTED: 'DUNNING_REQUESTED',
  DUNNING_RECEIVED: 'DUNNING_RECEIVED',
  AWAITING_RISK_ANALYSIS: 'AWAITING_RISK_ANALYSIS',
  DELETED: 'DELETED',
} as const satisfies Record<string, PaymentStatus>;

/**
 * @deprecated Use agrupamentos semânticos em `@alusa/finance` (`asaas-status-groups`).
 */
export const PAID_STATUSES: PaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.RECEIVED,
  ASAAS_PAYMENT_STATUS.CONFIRMED,
  ASAAS_PAYMENT_STATUS.RECEIVED_IN_CASH,
  ASAAS_PAYMENT_STATUS.DUNNING_RECEIVED,
];

/**
 * @deprecated Use agrupamentos semânticos em `@alusa/finance` (`asaas-status-groups`).
 */
export const FAILED_STATUSES: PaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.REFUNDED,
  ASAAS_PAYMENT_STATUS.REFUND_REQUESTED,
  ASAAS_PAYMENT_STATUS.REFUND_IN_PROGRESS,
  ASAAS_PAYMENT_STATUS.CHARGEBACK_REQUESTED,
  ASAAS_PAYMENT_STATUS.CHARGEBACK_DISPUTE,
  ASAAS_PAYMENT_STATUS.AWAITING_CHARGEBACK_REVERSAL,
  ASAAS_PAYMENT_STATUS.DELETED,
];

/**
 * @deprecated Use agrupamentos semânticos em `@alusa/finance` (`asaas-status-groups`).
 */
export const PENDING_STATUSES: PaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.PENDING,
  ASAAS_PAYMENT_STATUS.OVERDUE,
  ASAAS_PAYMENT_STATUS.AWAITING_RISK_ANALYSIS,
  ASAAS_PAYMENT_STATUS.DUNNING_REQUESTED,
];

/** @deprecated Use `isAsaasPaidStatus` de `@alusa/finance`. */
export function isPaidStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return PAID_STATUSES.includes(status as PaymentStatus);
}

/** @deprecated Use `isAsaasFailedStatus` de `@alusa/finance`. */
export function isFailedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return FAILED_STATUSES.includes(status as PaymentStatus);
}

/** @deprecated Use `isAsaasPendingStatus` de `@alusa/finance`. */
export function isPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return PENDING_STATUSES.includes(status as PaymentStatus);
}
