/**
 * Eventos de Webhook do Asaas
 * Fonte: https://docs.asaas.com/docs/sobre-os-webhooks
 */

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT (Cobrança)
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_PAYMENT_EVENTS = {
  /** Geração de nova cobrança */
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  /** Pagamento em cartão aguardando aprovação */
  PAYMENT_AWAITING_RISK_ANALYSIS: 'PAYMENT_AWAITING_RISK_ANALYSIS',
  /** Pagamento aprovado pela análise de risco */
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: 'PAYMENT_APPROVED_BY_RISK_ANALYSIS',
  /** Pagamento reprovado pela análise de risco */
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  /** Cobrança atualizada */
  PAYMENT_UPDATED: 'PAYMENT_UPDATED',
  /** Confirmação de recebimento */
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  /** Cobrança recebida (ainda não liquidada) */
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  /** Cobrança antecipada */
  PAYMENT_ANTICIPATED: 'PAYMENT_ANTICIPATED',
  /** Cobrança vencida */
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
  /** Cobrança removida */
  PAYMENT_DELETED: 'PAYMENT_DELETED',
  /** Cobrança restaurada */
  PAYMENT_RESTORED: 'PAYMENT_RESTORED',
  /** Cobrança estornada */
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  /** Estorno em processamento */
  PAYMENT_REFUND_IN_PROGRESS: 'PAYMENT_REFUND_IN_PROGRESS',
  /** Recebimento em dinheiro desfeito */
  PAYMENT_RECEIVED_IN_CASH_UNDONE: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  /** Recebimento em dinheiro confirmado */
  PAYMENT_RECEIVED_IN_CASH: 'PAYMENT_RECEIVED_IN_CASH',
  /** Chargeback solicitado */
  PAYMENT_CHARGEBACK_REQUESTED: 'PAYMENT_CHARGEBACK_REQUESTED',
  /** Chargeback em disputa */
  PAYMENT_CHARGEBACK_DISPUTE: 'PAYMENT_CHARGEBACK_DISPUTE',
  /** Aguardando reversão do chargeback */
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  /** Enviado para recuperação */
  PAYMENT_DUNNING_REQUESTED: 'PAYMENT_DUNNING_REQUESTED',
  /** Recuperado */
  PAYMENT_DUNNING_RECEIVED: 'PAYMENT_DUNNING_RECEIVED',
  /** Visualização do boleto pelo pagador */
  PAYMENT_BANK_SLIP_VIEWED: 'PAYMENT_BANK_SLIP_VIEWED',
  /** Falha de checkout pelo pagador */
  PAYMENT_CHECKOUT_VIEWED: 'PAYMENT_CHECKOUT_VIEWED',
} as const;

export type AsaasPaymentEvent = (typeof ASAAS_PAYMENT_EVENTS)[keyof typeof ASAAS_PAYMENT_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION (Assinatura)
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_SUBSCRIPTION_EVENTS = {
  /** Assinatura criada */
  SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
  /** Assinatura atualizada */
  SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',
  /** Assinatura inativada */
  SUBSCRIPTION_INACTIVATED: 'SUBSCRIPTION_INACTIVATED',
  /** Assinatura deletada */
  SUBSCRIPTION_DELETED: 'SUBSCRIPTION_DELETED',
  /** Split da assinatura desabilitado */
  SUBSCRIPTION_SPLIT_DISABLED: 'SUBSCRIPTION_SPLIT_DISABLED',
  /** Assinatura bloqueada por divergência de split */
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK: 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK',
  /** Bloqueio de split da assinatura finalizado */
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED: 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED',
} as const;

export type AsaasSubscriptionEvent = (typeof ASAAS_SUBSCRIPTION_EVENTS)[keyof typeof ASAAS_SUBSCRIPTION_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER (Transferência)
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_TRANSFER_EVENTS = {
  /** Transferência criada */
  TRANSFER_CREATED: 'TRANSFER_CREATED',
  /** Transferência pendente */
  TRANSFER_PENDING: 'TRANSFER_PENDING',
  /** Transferência em processamento bancário */
  TRANSFER_IN_BANK_PROCESSING: 'TRANSFER_IN_BANK_PROCESSING',
  /** Transferência bloqueada */
  TRANSFER_BLOCKED: 'TRANSFER_BLOCKED',
  /** Transferência concluída */
  TRANSFER_DONE: 'TRANSFER_DONE',
  /** Transferência falhou */
  TRANSFER_FAILED: 'TRANSFER_FAILED',
  /** Transferência cancelada */
  TRANSFER_CANCELLED: 'TRANSFER_CANCELLED',
} as const;

export type AsaasTransferEvent = (typeof ASAAS_TRANSFER_EVENTS)[keyof typeof ASAAS_TRANSFER_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT STATUS
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_ACCOUNT_EVENTS = {
  /** Conta aprovada */
  ACCOUNT_STATUS_APPROVED: 'ACCOUNT_STATUS_APPROVED',
  /** Conta pendente de documentação */
  ACCOUNT_STATUS_AWAITING_DOCUMENTS: 'ACCOUNT_STATUS_AWAITING_DOCUMENTS',
  /** Documentação em análise */
  ACCOUNT_STATUS_AWAITING_DOCUMENTS_REVIEW: 'ACCOUNT_STATUS_AWAITING_DOCUMENTS_REVIEW',
  /** Conta com restrições */
  ACCOUNT_STATUS_WITH_RESTRICTIONS: 'ACCOUNT_STATUS_WITH_RESTRICTIONS',
  /** Conta suspensa */
  ACCOUNT_STATUS_SUSPENDED: 'ACCOUNT_STATUS_SUSPENDED',
} as const;

export type AsaasAccountEvent = (typeof ASAAS_ACCOUNT_EVENTS)[keyof typeof ASAAS_ACCOUNT_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TRANSFER
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_INTERNAL_TRANSFER_EVENTS = {
  /** Crédito em transferência interna */
  INTERNAL_TRANSFER_CREDIT: 'INTERNAL_TRANSFER_CREDIT',
  /** Débito em transferência interna */
  INTERNAL_TRANSFER_DEBIT: 'INTERNAL_TRANSFER_DEBIT',
} as const;

export type AsaasInternalTransferEvent = (typeof ASAAS_INTERNAL_TRANSFER_EVENTS)[keyof typeof ASAAS_INTERNAL_TRANSFER_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// ALL EVENTS
// ─────────────────────────────────────────────────────────────────────────────
export const ASAAS_EVENTS = {
  ...ASAAS_PAYMENT_EVENTS,
  ...ASAAS_SUBSCRIPTION_EVENTS,
  ...ASAAS_TRANSFER_EVENTS,
  ...ASAAS_ACCOUNT_EVENTS,
  ...ASAAS_INTERNAL_TRANSFER_EVENTS,
} as const;

export type AsaasEvent = (typeof ASAAS_EVENTS)[keyof typeof ASAAS_EVENTS];

/**
 * Verifica se é um evento de pagamento
 */
export function isPaymentEvent(event: string): event is AsaasPaymentEvent {
  return event.startsWith('PAYMENT_');
}

/**
 * Verifica se é um evento de assinatura
 */
export function isSubscriptionEvent(event: string): event is AsaasSubscriptionEvent {
  return event.startsWith('SUBSCRIPTION_');
}

/**
 * Verifica se é um evento de transferência
 */
export function isTransferEvent(event: string): event is AsaasTransferEvent {
  return event.startsWith('TRANSFER_');
}

/**
 * Verifica se é um evento de conta
 */
export function isAccountEvent(event: string): event is AsaasAccountEvent {
  return event.startsWith('ACCOUNT_STATUS_');
}

/**
 * Verifica se é um evento de transferência interna
 */
export function isInternalTransferEvent(event: string): event is AsaasInternalTransferEvent {
  return event.startsWith('INTERNAL_TRANSFER_');
}

/**
 * Eventos que representam "estado final positivo" de pagamento
 */
export const FINAL_POSITIVE_PAYMENT_EVENTS: AsaasPaymentEvent[] = [
  ASAAS_PAYMENT_EVENTS.PAYMENT_CONFIRMED,
  ASAAS_PAYMENT_EVENTS.PAYMENT_RECEIVED,
  ASAAS_PAYMENT_EVENTS.PAYMENT_RECEIVED_IN_CASH,
  ASAAS_PAYMENT_EVENTS.PAYMENT_DUNNING_RECEIVED,
];

/**
 * Eventos que representam "estado final negativo" de pagamento
 */
export const FINAL_NEGATIVE_PAYMENT_EVENTS: AsaasPaymentEvent[] = [
  ASAAS_PAYMENT_EVENTS.PAYMENT_DELETED,
  ASAAS_PAYMENT_EVENTS.PAYMENT_REFUNDED,
  ASAAS_PAYMENT_EVENTS.PAYMENT_CHARGEBACK_REQUESTED,
];
