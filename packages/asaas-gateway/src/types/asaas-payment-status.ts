/**
 * Status de Payment do Asaas (completo)
 * Fonte: https://docs.asaas.com/reference/list-payments-of-a-subscription
 */
export const ASAAS_PAYMENT_STATUS = {
  /** Aguardando pagamento */
  PENDING: 'PENDING',
  /** Recebido (ainda não confirmado/liquidado) */
  RECEIVED: 'RECEIVED',
  /** Confirmado (liquidado/creditado) */
  CONFIRMED: 'CONFIRMED',
  /** Vencido */
  OVERDUE: 'OVERDUE',
  /** Estornado */
  REFUNDED: 'REFUNDED',
  /** Solicitação de estorno recebida */
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  /** Estorno em processamento */
  REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
  /** Recebido em dinheiro (confirmado manualmente) */
  RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
  /** Chargeback */
  CHARGEBACK_REQUESTED: 'CHARGEBACK_REQUESTED',
  /** Chargeback em disputa */
  CHARGEBACK_DISPUTE: 'CHARGEBACK_DISPUTE',
  /** Chargeback confirmado */
  AWAITING_CHARGEBACK_REVERSAL: 'AWAITING_CHARGEBACK_REVERSAL',
  /** Falha no pagamento (cartão recusado etc.) */
  DUNNING_REQUESTED: 'DUNNING_REQUESTED',
  /** Recuperação de cobrança via régua */
  DUNNING_RECEIVED: 'DUNNING_RECEIVED',
  /** Aguardando risco */
  AWAITING_RISK_ANALYSIS: 'AWAITING_RISK_ANALYSIS',
  /** Cobrança removida/deletada */
  DELETED: 'DELETED',
} as const;

export type AsaasPaymentStatus = (typeof ASAAS_PAYMENT_STATUS)[keyof typeof ASAAS_PAYMENT_STATUS];

/**
 * Status de pagamento que representam "pago" (dinheiro recebido)
 */
export const PAID_STATUSES: AsaasPaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.RECEIVED,
  ASAAS_PAYMENT_STATUS.CONFIRMED,
  ASAAS_PAYMENT_STATUS.RECEIVED_IN_CASH,
  ASAAS_PAYMENT_STATUS.DUNNING_RECEIVED,
];

/**
 * Status de pagamento que representam "falha/cancelamento"
 */
export const FAILED_STATUSES: AsaasPaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.REFUNDED,
  ASAAS_PAYMENT_STATUS.REFUND_REQUESTED,
  ASAAS_PAYMENT_STATUS.REFUND_IN_PROGRESS,
  ASAAS_PAYMENT_STATUS.CHARGEBACK_REQUESTED,
  ASAAS_PAYMENT_STATUS.CHARGEBACK_DISPUTE,
  ASAAS_PAYMENT_STATUS.AWAITING_CHARGEBACK_REVERSAL,
  ASAAS_PAYMENT_STATUS.DELETED,
];

/**
 * Status de pagamento que representam "pendente"
 */
export const PENDING_STATUSES: AsaasPaymentStatus[] = [
  ASAAS_PAYMENT_STATUS.PENDING,
  ASAAS_PAYMENT_STATUS.OVERDUE,
  ASAAS_PAYMENT_STATUS.AWAITING_RISK_ANALYSIS,
  ASAAS_PAYMENT_STATUS.DUNNING_REQUESTED,
];

/**
 * Verifica se o status representa pagamento confirmado
 */
export function isPaidStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return PAID_STATUSES.includes(status as AsaasPaymentStatus);
}

/**
 * Verifica se o status representa falha/cancelamento
 */
export function isFailedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return FAILED_STATUSES.includes(status as AsaasPaymentStatus);
}

/**
 * Verifica se o status representa pendência
 */
export function isPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return PENDING_STATUSES.includes(status as AsaasPaymentStatus);
}
