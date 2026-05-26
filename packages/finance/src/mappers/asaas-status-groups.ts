/**
 * Agrupamentos semânticos de status brutos do Asaas.
 * Fonte canônica de "pago", "falhou" e "pendente" para orquestração financeira.
 */

import type { PaymentStatus } from '@alusa/asaas';

export const ASAAS_PAID_STATUSES: PaymentStatus[] = [
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
];

export const ASAAS_FAILED_STATUSES: PaymentStatus[] = [
  'REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DELETED',
];

export const ASAAS_PENDING_STATUSES: PaymentStatus[] = [
  'PENDING',
  'OVERDUE',
  'AWAITING_RISK_ANALYSIS',
  'DUNNING_REQUESTED',
];

export function isAsaasPaidStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ASAAS_PAID_STATUSES.includes(status as PaymentStatus);
}

export function isAsaasFailedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ASAAS_FAILED_STATUSES.includes(status as PaymentStatus);
}

export function isAsaasPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ASAAS_PENDING_STATUSES.includes(status as PaymentStatus);
}
