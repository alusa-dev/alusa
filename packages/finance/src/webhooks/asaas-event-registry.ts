/**
 * Asaas Webhook Event Registry
 *
 * Mapeamento 100% dos eventos de webhook do Asaas.
 * Fonte: https://docs.asaas.com/docs/eventos-de-webhooks
 *
 * Cada evento possui:
 * - category: categoria do evento (PAYMENT, SUBSCRIPTION, etc.)
 * - handled: se o evento possui handler implementado
 * - handler: nome do handler responsável
 * - description: descrição do evento
 * - impactLevel: nível de impacto no sistema (critical, high, medium, low, info)
 * - requiresSync: se requer sincronização de estado financeiro
 */

export type EventImpactLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type EventCategory =
  | 'PAYMENT'
  | 'SUBSCRIPTION'
  | 'TRANSFER'
  | 'ACCOUNT_STATUS'
  | 'INVOICE'
  | 'BILL'
  | 'ANTICIPATION'
  | 'PHONE_RECHARGE'
  | 'CHECKOUT'
  | 'BALANCE'
  | 'INTERNAL_TRANSFER'
  | 'ACCESS_TOKEN'
  | 'PIX_AUTOMATIC';

export interface AsaasEventDefinition {
  category: EventCategory;
  handled: boolean;
  handler: string | null;
  description: string;
  impactLevel: EventImpactLevel;
  requiresSync: boolean;
}

export type WebhookEventPolicyCategory =
  | 'PAYMENT'
  | 'SUBSCRIPTION'
  | 'TRANSFER'
  | 'ACCOUNT_STATUS'
  | 'BALANCE'
  | 'ACCESS_TOKEN'
  | 'ANTICIPATION'
  | 'AUDIT_ONLY'
  | 'UNUSED';

export type WebhookEventHandlingMode =
  | 'STATE_CHANGE'
  | 'AUDIT_ONLY'
  | 'NOT_USED'
  | 'UNKNOWN_ALERT';

export type WebhookEventCriticality = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type WebhookEventPolicy = {
  event: string;
  category: WebhookEventPolicyCategory;
  handlingMode: WebhookEventHandlingMode;
  criticality: WebhookEventCriticality;
  mustProvision: boolean;
  requiresReconciliation: boolean;
};

/**
 * Registry completo de eventos Asaas
 */
export const ASAAS_EVENT_REGISTRY: Record<string, AsaasEventDefinition> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT EVENTS (Cobranças)
  // Handler: payment-webhook-handler.ts
  // ═══════════════════════════════════════════════════════════════════════════
  PAYMENT_CREATED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Geração de uma nova cobrança',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_AWAITING_RISK_ANALYSIS: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Pagamento cartão aguardando análise de risco manual',
    impactLevel: 'medium',
    requiresSync: true,
  },
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Pagamento cartão aprovado pela análise de risco',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Pagamento cartão reprovado pela análise de risco',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_AUTHORIZED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Pagamento cartão autorizado, aguardando captura',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_UPDATED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Alteração no vencimento ou valor de cobrança existente',
    impactLevel: 'medium',
    requiresSync: true,
  },
  PAYMENT_CONFIRMED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança confirmada (pagamento recebido, saldo não disponível)',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_RECEIVED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança recebida (saldo disponível)',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Falha na captura do pagamento com cartão de crédito',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_ANTICIPATED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança antecipada',
    impactLevel: 'medium',
    requiresSync: true,
  },
  PAYMENT_OVERDUE: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança vencida',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_DELETED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança removida',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_RESTORED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança restaurada',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_REFUNDED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança estornada',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_PARTIALLY_REFUNDED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Cobrança parcialmente estornada',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_REFUND_IN_PROGRESS: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Estorno em processamento',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_RECEIVED_IN_CASH_UNDONE: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Recebimento em dinheiro desfeito',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_CHARGEBACK_REQUESTED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Chargeback recebido',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_CHARGEBACK_DISPUTE: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Em disputa de chargeback',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Disputa ganha, aguardando transferência',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_DUNNING_RECEIVED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Negativação Serasa recebida',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_DUNNING_REQUESTED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Solicitação de negativação Serasa',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_BANK_SLIP_VIEWED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Boleto visualizado pelo cliente',
    impactLevel: 'info',
    requiresSync: false,
  },
  PAYMENT_CHECKOUT_VIEWED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Fatura visualizada pelo cliente',
    impactLevel: 'info',
    requiresSync: false,
  },
  PAYMENT_SPLIT_DIVERGENCE_BLOCK: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Valor bloqueado por divergência de split',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Bloqueio por divergência de split liberado',
    impactLevel: 'medium',
    requiresSync: true,
  },
  PAYMENT_REFUND_DENIED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Estorno negado',
    impactLevel: 'critical',
    requiresSync: true,
  },
  PAYMENT_BANK_SLIP_CANCELLED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Boleto cancelado',
    impactLevel: 'high',
    requiresSync: true,
  },
  PAYMENT_SPLIT_CANCELLED: {
    category: 'PAYMENT',
    handled: true,
    handler: 'handlePaymentWebhook',
    description: 'Split de pagamento cancelado',
    impactLevel: 'high',
    requiresSync: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTION EVENTS (Assinaturas/Recorrência)
  // Handler: subscription-webhook-handler.ts
  // ═══════════════════════════════════════════════════════════════════════════
  SUBSCRIPTION_CREATED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Geração de nova assinatura',
    impactLevel: 'high',
    requiresSync: true,
  },
  SUBSCRIPTION_UPDATED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Alteração em assinatura',
    impactLevel: 'medium',
    requiresSync: true,
  },
  SUBSCRIPTION_INACTIVATED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Assinatura inativada',
    impactLevel: 'critical',
    requiresSync: true,
  },
  SUBSCRIPTION_DELETED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Assinatura removida',
    impactLevel: 'critical',
    requiresSync: true,
  },
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Assinatura bloqueada por divergência de split',
    impactLevel: 'high',
    requiresSync: true,
  },
  SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Bloqueio de assinatura por divergência de split finalizado',
    impactLevel: 'medium',
    requiresSync: true,
  },
  SUBSCRIPTION_SPLIT_DISABLED: {
    category: 'SUBSCRIPTION',
    handled: true,
    handler: 'handleSubscriptionWebhook',
    description: 'Split da assinatura desabilitado',
    impactLevel: 'high',
    requiresSync: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER EVENTS (Transferências bancárias)
  // Handler: transfer-webhook-handler.ts
  // ═══════════════════════════════════════════════════════════════════════════
  TRANSFER_CREATED: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Criação de nova transferência',
    impactLevel: 'medium',
    requiresSync: true,
  },
  TRANSFER_PENDING: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência pendente de execução',
    impactLevel: 'low',
    requiresSync: true,
  },
  TRANSFER_IN_BANK_PROCESSING: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência em processamento bancário',
    impactLevel: 'low',
    requiresSync: true,
  },
  TRANSFER_BLOCKED: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência bloqueada',
    impactLevel: 'high',
    requiresSync: true,
  },
  TRANSFER_DONE: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência concluída',
    impactLevel: 'medium',
    requiresSync: true,
  },
  TRANSFER_FAILED: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência falhou',
    impactLevel: 'critical',
    requiresSync: true,
  },
  TRANSFER_CANCELLED: {
    category: 'TRANSFER',
    handled: true,
    handler: 'handleTransferWebhook',
    description: 'Transferência cancelada',
    impactLevel: 'high',
    requiresSync: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT STATUS EVENTS (Status da conta/subconta)
  // Handler: account-webhook-handler.ts
  // ═══════════════════════════════════════════════════════════════════════════
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta bancária aprovada',
    impactLevel: 'high',
    requiresSync: true,
  },
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta bancária em análise',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Status de conta bancária revertido para pendente',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta bancária rejeitada',
    impactLevel: 'critical',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Informações comerciais aprovadas',
    impactLevel: 'high',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Informações comerciais em análise',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Status de informações comerciais revertido para pendente',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Informações comerciais rejeitadas',
    impactLevel: 'critical',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Dados comerciais próximos de expirar',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Dados comerciais expirados',
    impactLevel: 'critical',
    requiresSync: true,
  },
  ACCOUNT_STATUS_DOCUMENT_APPROVED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Documentos aprovados',
    impactLevel: 'high',
    requiresSync: true,
  },
  ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Documentos em análise',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_DOCUMENT_PENDING: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Status de documentos revertido para pendente',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_DOCUMENT_REJECTED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Documentos rejeitados',
    impactLevel: 'critical',
    requiresSync: true,
  },
  ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta aprovada',
    impactLevel: 'critical',
    requiresSync: true,
  },
  ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta em análise',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Status de conta revertido para pendente',
    impactLevel: 'medium',
    requiresSync: true,
  },
  ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED: {
    category: 'ACCOUNT_STATUS',
    handled: true,
    handler: 'handleAccountWebhook',
    description: 'Conta rejeitada',
    impactLevel: 'critical',
    requiresSync: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL TRANSFER EVENTS (Transferências internas entre subcontas)
  // Handler: internal-transfer-webhook-handler.ts
  // ═══════════════════════════════════════════════════════════════════════════
  INTERNAL_TRANSFER_CREDIT: {
    category: 'INTERNAL_TRANSFER',
    handled: true,
    handler: 'handleInternalTransferWebhook',
    description: 'Crédito de transferência interna entre subcontas',
    impactLevel: 'low',
    requiresSync: false,
  },
  INTERNAL_TRANSFER_DEBIT: {
    category: 'INTERNAL_TRANSFER',
    handled: true,
    handler: 'handleInternalTransferWebhook',
    description: 'Débito de transferência interna entre subcontas',
    impactLevel: 'low',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICE EVENTS (Notas fiscais) - NÃO UTILIZADO NO FLUXO ALUSA
  // ═══════════════════════════════════════════════════════════════════════════
  INVOICE_CREATED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal criada',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_UPDATED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal atualizada',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_SYNCHRONIZED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal sincronizada com prefeitura',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_AUTHORIZED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal autorizada',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_PROCESSING_CANCELLATION: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal em processo de cancelamento',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_CANCELED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Nota fiscal cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_CANCELLATION_DENIED: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Cancelamento de nota fiscal negado',
    impactLevel: 'info',
    requiresSync: false,
  },
  INVOICE_ERROR: {
    category: 'INVOICE',
    handled: false,
    handler: null,
    description: 'Erro na nota fiscal',
    impactLevel: 'info',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BILL EVENTS (Pague Contas) - NÃO UTILIZADO NO FLUXO ALUSA
  // ═══════════════════════════════════════════════════════════════════════════
  BILL_CREATED: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta criada para pagamento',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_PENDING: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta pendente de pagamento',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_BANK_PROCESSING: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta em processamento bancário',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_PAID: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta paga',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_CANCELLED: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_FAILED: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Falha no pagamento de conta',
    impactLevel: 'info',
    requiresSync: false,
  },
  BILL_REFUNDED: {
    category: 'BILL',
    handled: false,
    handler: null,
    description: 'Conta estornada',
    impactLevel: 'info',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ANTICIPATION EVENTS (Antecipações) - observabilidade e auditoria
  // ═══════════════════════════════════════════════════════════════════════════
  RECEIVABLE_ANTICIPATION_CANCELLED: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_PENDING: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação pendente',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_DENIED: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação negada',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_SCHEDULED: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação agendada',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_CREDITED: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação creditada',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_DEBITED: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação debitada',
    impactLevel: 'info',
    requiresSync: false,
  },
  RECEIVABLE_ANTICIPATION_OVERDUE: {
    category: 'ANTICIPATION',
    handled: true,
    handler: 'handleAnticipationWebhook',
    description: 'Antecipação vencida',
    impactLevel: 'info',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHONE RECHARGE EVENTS (Recargas) - NÃO UTILIZADO NO FLUXO ALUSA
  // ═══════════════════════════════════════════════════════════════════════════
  MOBILE_PHONE_RECHARGE_PENDING: {
    category: 'PHONE_RECHARGE',
    handled: false,
    handler: null,
    description: 'Recarga de celular pendente',
    impactLevel: 'info',
    requiresSync: false,
  },
  MOBILE_PHONE_RECHARGE_CONFIRMED: {
    category: 'PHONE_RECHARGE',
    handled: false,
    handler: null,
    description: 'Recarga de celular confirmada',
    impactLevel: 'info',
    requiresSync: false,
  },
  MOBILE_PHONE_RECHARGE_CANCELLED: {
    category: 'PHONE_RECHARGE',
    handled: false,
    handler: null,
    description: 'Recarga de celular cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  MOBILE_PHONE_RECHARGE_REFUNDED: {
    category: 'PHONE_RECHARGE',
    handled: false,
    handler: null,
    description: 'Recarga de celular estornada',
    impactLevel: 'info',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKOUT EVENTS - NÃO UTILIZADO NO FLUXO ALUSA
  // Nomes oficiais: CHECKOUT_CREATED, CHECKOUT_CANCELED, CHECKOUT_EXPIRED, CHECKOUT_PAID
  // ═══════════════════════════════════════════════════════════════════════════
  CHECKOUT_CREATED: {
    category: 'CHECKOUT',
    handled: false,
    handler: null,
    description: 'Link de pagamento (checkout) criado',
    impactLevel: 'info',
    requiresSync: false,
  },
  CHECKOUT_CANCELED: {
    category: 'CHECKOUT',
    handled: false,
    handler: null,
    description: 'Checkout cancelado',
    impactLevel: 'info',
    requiresSync: false,
  },
  CHECKOUT_EXPIRED: {
    category: 'CHECKOUT',
    handled: false,
    handler: null,
    description: 'Checkout expirado',
    impactLevel: 'info',
    requiresSync: false,
  },
  CHECKOUT_PAID: {
    category: 'CHECKOUT',
    handled: false,
    handler: null,
    description: 'Checkout pago',
    impactLevel: 'info',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BALANCE EVENTS - NÃO UTILIZADO NO FLUXO ALUSA
  // Nomes oficiais: BALANCE_VALUE_BLOCKED, BALANCE_VALUE_UNBLOCKED
  // ═══════════════════════════════════════════════════════════════════════════
  BALANCE_VALUE_BLOCKED: {
    category: 'BALANCE',
    handled: true,
    handler: 'handleBalanceWebhook',
    description: 'Valor de saldo bloqueado',
    impactLevel: 'critical',
    requiresSync: false,
  },
  BALANCE_VALUE_UNBLOCKED: {
    category: 'BALANCE',
    handled: true,
    handler: 'handleBalanceWebhook',
    description: 'Valor de saldo desbloqueado',
    impactLevel: 'high',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS TOKEN EVENTS - NÃO UTILIZADO NO FLUXO ALUSA
  // Nomes oficiais: ACCESS_TOKEN_* (substituem API_KEY_*)
  // ═══════════════════════════════════════════════════════════════════════════
  ACCESS_TOKEN_CREATED: {
    category: 'ACCESS_TOKEN',
    handled: false,
    handler: null,
    description: 'Token de acesso criado',
    impactLevel: 'info',
    requiresSync: false,
  },
  ACCESS_TOKEN_DELETED: {
    category: 'ACCESS_TOKEN',
    handled: false,
    handler: null,
    description: 'Token de acesso removido',
    impactLevel: 'info',
    requiresSync: false,
  },
  ACCESS_TOKEN_DISABLED: {
    category: 'ACCESS_TOKEN',
    handled: false,
    handler: null,
    description: 'Token de acesso desabilitado',
    impactLevel: 'info',
    requiresSync: false,
  },
  ACCESS_TOKEN_ENABLED: {
    category: 'ACCESS_TOKEN',
    handled: false,
    handler: null,
    description: 'Token de acesso habilitado',
    impactLevel: 'info',
    requiresSync: false,
  },
  ACCESS_TOKEN_EXPIRED: {
    category: 'ACCESS_TOKEN',
    handled: true,
    handler: 'handleAccessTokenWebhook',
    description: 'Token de acesso expirado',
    impactLevel: 'critical',
    requiresSync: false,
  },
  ACCESS_TOKEN_EXPIRING_SOON: {
    category: 'ACCESS_TOKEN',
    handled: true,
    handler: 'handleAccessTokenWebhook',
    description: 'Token de acesso próximo de expirar',
    impactLevel: 'high',
    requiresSync: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PIX AUTOMATIC EVENTS (Pix Automático/Recorrente) - NÃO UTILIZADO NO FLUXO ALUSA
  // ═══════════════════════════════════════════════════════════════════════════
  PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Autorização de Pix automático criada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Autorização de Pix automático ativada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Autorização de Pix automático cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Autorização de Pix automático expirada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Autorização de Pix automático recusada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Instrução de pagamento Pix automático criada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Instrução de pagamento Pix automático agendada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Instrução de pagamento Pix automático recusada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Instrução de pagamento Pix automático cancelada',
    impactLevel: 'info',
    requiresSync: false,
  },
  PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED: {
    category: 'PIX_AUTOMATIC',
    handled: false,
    handler: null,
    description: 'Elegibilidade de Pix automático atualizada',
    impactLevel: 'info',
    requiresSync: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se um evento é conhecido (registrado)
 */
export function isKnownEvent(event: string): boolean {
  return event in ASAAS_EVENT_REGISTRY;
}

/**
 * Verifica se um evento possui handler implementado
 */
export function isHandledEvent(event: string): boolean {
  return ASAAS_EVENT_REGISTRY[event]?.handled ?? false;
}

/**
 * Retorna a definição de um evento
 */
export function getEventDefinition(event: string): AsaasEventDefinition | null {
  return ASAAS_EVENT_REGISTRY[event] ?? null;
}

/**
 * Retorna todos os eventos de uma categoria
 */
export function getEventsByCategory(category: EventCategory): string[] {
  return Object.entries(ASAAS_EVENT_REGISTRY)
    .filter(([, def]) => def.category === category)
    .map(([event]) => event);
}

/**
 * Retorna todos os eventos handled
 */
export function getHandledEvents(): string[] {
  return Object.entries(ASAAS_EVENT_REGISTRY)
    .filter(([, def]) => def.handled)
    .map(([event]) => event);
}

/**
 * Retorna todos os eventos NÃO handled (para alertas)
 */
export function getUnhandledEvents(): string[] {
  return Object.entries(ASAAS_EVENT_REGISTRY)
    .filter(([, def]) => !def.handled)
    .map(([event]) => event);
}

/**
 * Retorna todos os eventos críticos
 */
export function getCriticalEvents(): string[] {
  return Object.entries(ASAAS_EVENT_REGISTRY)
    .filter(([, def]) => def.impactLevel === 'critical')
    .map(([event]) => event);
}

function toPolicyCategory(category: EventCategory): WebhookEventPolicyCategory {
  if (
    category === 'PAYMENT' ||
    category === 'SUBSCRIPTION' ||
    category === 'TRANSFER' ||
    category === 'ACCOUNT_STATUS' ||
    category === 'BALANCE' ||
    category === 'ACCESS_TOKEN' ||
    category === 'ANTICIPATION'
  ) {
    return category;
  }

  if (category === 'INTERNAL_TRANSFER' || category === 'INVOICE' || category === 'BILL') {
    return 'AUDIT_ONLY';
  }

  return 'UNUSED';
}

function toCriticality(level: EventImpactLevel): WebhookEventCriticality {
  switch (level) {
    case 'critical':
      return 'CRITICAL';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    case 'info':
      return 'INFO';
  }
}

export function getWebhookEventPolicy(event: string): WebhookEventPolicy {
  const definition = ASAAS_EVENT_REGISTRY[event];
  if (!definition) {
    return {
      event,
      category: 'AUDIT_ONLY',
      handlingMode: 'UNKNOWN_ALERT',
      criticality: 'HIGH',
      mustProvision: false,
      requiresReconciliation: true,
    };
  }

  const isAuditOnly = definition.handled && !definition.requiresSync && definition.impactLevel === 'info';
  return {
    event,
    category: toPolicyCategory(definition.category),
    handlingMode: definition.handled
      ? isAuditOnly
        ? 'AUDIT_ONLY'
        : 'STATE_CHANGE'
      : 'NOT_USED',
    criticality: toCriticality(definition.impactLevel),
    mustProvision: definition.handled,
    requiresReconciliation: definition.requiresSync || ['critical', 'high'].includes(definition.impactLevel),
  };
}

export function getWebhookEventPolicies(): WebhookEventPolicy[] {
  return Object.keys(ASAAS_EVENT_REGISTRY)
    .sort()
    .map((event) => getWebhookEventPolicy(event));
}

export function shouldAlertUnknownWebhookEvent(event: string): boolean {
  const policy = getWebhookEventPolicy(event);
  return policy.handlingMode === 'UNKNOWN_ALERT' || policy.criticality === 'CRITICAL' || policy.criticality === 'HIGH';
}

/**
 * Retorna estatísticas do registry
 */
export function getRegistryStats(): {
  total: number;
  handled: number;
  unhandled: number;
  critical: number;
  byCategory: Record<EventCategory, number>;
} {
  const entries = Object.values(ASAAS_EVENT_REGISTRY);
  const byCategory = {} as Record<EventCategory, number>;

  for (const def of entries) {
    byCategory[def.category] = (byCategory[def.category] ?? 0) + 1;
  }

  return {
    total: entries.length,
    handled: entries.filter((d) => d.handled).length,
    unhandled: entries.filter((d) => !d.handled).length,
    critical: entries.filter((d) => d.impactLevel === 'critical').length,
    byCategory,
  };
}
