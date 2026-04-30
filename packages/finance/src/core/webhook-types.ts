/**
 * Webhook Types - Tipos canônicos para eventos de webhook
 * 
 * Definições centralizadas para:
 * - Payloads de webhook do Asaas
 * - Eventos suportados por categoria
 * - Tipos de resposta dos handlers
 */

import type { AsaasPaymentStatus } from './status-mapping';

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK EVENTS - Categorias e eventos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Categorias de eventos de webhook
 */
export type WebhookEventCategory =
  | 'PAYMENT'
  | 'SUBSCRIPTION'
  | 'TRANSFER'
  | 'ACCOUNT_STATUS'
  | 'INVOICE'
  | 'INTERNAL_TRANSFER';

/**
 * Eventos de pagamento (PAYMENT_*)
 */
export type PaymentEvent =
  | 'PAYMENT_CREATED'
  | 'PAYMENT_AWAITING_RISK_ANALYSIS'
  | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
  | 'PAYMENT_ANTICIPATED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_RESTORED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
  | 'PAYMENT_DUNNING_RECEIVED'
  | 'PAYMENT_DUNNING_REQUESTED'
  | 'PAYMENT_BANK_SLIP_VIEWED'
  | 'PAYMENT_CHECKOUT_VIEWED'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED';

/**
 * Eventos de assinatura (SUBSCRIPTION_*)
 */
export type SubscriptionEvent =
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_DELETED'
  | 'SUBSCRIPTION_INACTIVATED'
  | 'SUBSCRIPTION_SPLIT_DISABLED'
  | 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK'
  | 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED';

/**
 * Eventos de transferência (TRANSFER_*)
 */
export type TransferEvent =
  | 'TRANSFER_CREATED'
  | 'TRANSFER_PENDING'
  | 'TRANSFER_IN_BANK_PROCESSING'
  | 'TRANSFER_BLOCKED'
  | 'TRANSFER_DONE'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED';

/**
 * Todos os eventos suportados
 */
export type WebhookEvent = PaymentEvent | SubscriptionEvent | TransferEvent | string;

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK PAYLOADS - Estruturas de dados
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Payload base de webhook do Asaas
 */
export interface AsaasWebhookBasePayload {
  id?: string; // eventId
  event: string;
  dateCreated?: string;
  additionalInfo?: {
    scheduledDate?: string;
  };
}

/**
 * Payload de webhook de pagamento
 */
export interface PaymentWebhookPayload extends AsaasWebhookBasePayload {
  payment: {
    id: string;
    object?: 'payment';
    dateCreated?: string;
    customer: string;
    subscription?: string | null;
    installment?: string | null;
    paymentLink?: string | null;
    value: number;
    netValue: number;
    originalValue?: number | null;
    interestValue?: number | null;
    description?: string | null;
    billingType: string;
    status: AsaasPaymentStatus;
    dueDate: string;
    originalDueDate?: string | null;
    paymentDate?: string | null;
    clientPaymentDate?: string | null;
    installmentNumber?: number | null;
    invoiceUrl?: string | null;
    invoiceNumber?: string | null;
    externalReference?: string | null;
    deleted?: boolean;
    anticipated?: boolean;
    anticipable?: boolean;
    creditDate?: string | null;
    estimatedCreditDate?: string | null;
    transactionReceiptUrl?: string | null;
    nossoNumero?: string | null;
    bankSlipUrl?: string | null;
    postalService?: boolean;
    discount?: {
      value: number;
      type: 'FIXED' | 'PERCENTAGE';
      dueDateLimitDays?: number;
    } | null;
    fine?: {
      value: number;
      type?: 'FIXED' | 'PERCENTAGE';
    } | null;
    interest?: {
      value: number;
    } | null;
    split?: Array<{
      walletId: string;
      fixedValue?: number;
      percentualValue?: number;
    }>;
    chargeback?: {
      status: string;
      reason: string;
    } | null;
    refunds?: Array<{
      dateCreated: string;
      status: string;
      value: number;
    }>;
  };
}

/**
 * Payload de webhook de assinatura
 */
export interface SubscriptionWebhookPayload extends AsaasWebhookBasePayload {
  subscription: {
    id: string;
    object?: 'subscription';
    dateCreated?: string;
    customer: string;
    paymentLink?: string | null;
    billingType: string;
    value: number;
    nextDueDate: string;
    cycle: string;
    description?: string | null;
    endDate?: string | null;
    maxPayments?: number | null;
    externalReference?: string | null;
    split?: Array<{
      walletId: string;
      fixedValue?: number;
      percentualValue?: number;
    }>;
    deleted?: boolean;
    status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  };
}

/**
 * Payload de webhook de transferência
 */
export interface TransferWebhookPayload extends AsaasWebhookBasePayload {
  transfer: {
    id: string;
    object?: 'transfer';
    dateCreated?: string;
    value: number;
    netValue?: number;
    status: string;
    transferFee?: number;
    effectiveDate?: string | null;
    endToEndIdentifier?: string | null;
    transactionReceiptUrl?: string | null;
    description?: string | null;
    externalReference?: string | null;
    authorized?: boolean;
    failReason?: string | null;
    bankAccount?: {
      bank: { code: string; name?: string };
      accountName?: string;
      ownerName?: string;
      cpfCnpj?: string;
      agency?: string;
      agencyDigit?: string;
      account?: string;
      accountDigit?: string;
      accountType?: string;
    };
  };
}

/**
 * Payload de webhook de transferência interna
 */
export interface InternalTransferWebhookPayload extends AsaasWebhookBasePayload {
  internalTransfer: {
    id: string;
    value: number;
    netValue?: number;
    description?: string;
    dateCreated?: string;
    status: string;
  };
}

/**
 * Payload de webhook de conta
 */
export interface AccountWebhookPayload extends AsaasWebhookBasePayload {
  accountStatus: {
    id?: string;
    commercialInfo?: string;
    documentation?: string;
    general?: string;
    bankAccountInfo?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER TYPES - Respostas e resultados
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resultado de processamento de webhook
 */
export interface WebhookHandlerResult {
  success: boolean;
  error?: string;
  /** Se o webhook foi ignorado (ex: evento não relevante) */
  skipped?: boolean;
  /** Se o webhook já havia sido processado (idempotência) */
  duplicate?: boolean;
  /** Metadados do processamento */
  metadata?: Record<string, unknown>;
}

/**
 * Resultado completo de processamento (usado pelo handler principal)
 */
export interface WebhookProcessResult {
  ok: boolean;
  httpStatus: number;
  error?: string;
  message?: string;
  durationMs: number;
  webhookId?: string;
  duplicate?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o evento é de pagamento
 */
export function isPaymentEvent(event: string): event is PaymentEvent {
  return event.startsWith('PAYMENT_');
}

/**
 * Verifica se o evento é de assinatura
 */
export function isSubscriptionEvent(event: string): event is SubscriptionEvent {
  return event.startsWith('SUBSCRIPTION_');
}

/**
 * Verifica se o evento é de transferência
 */
export function isTransferEvent(event: string): event is TransferEvent {
  return event.startsWith('TRANSFER_');
}

/**
 * Extrai a categoria do evento
 */
export function getEventCategory(event: string): WebhookEventCategory | 'UNKNOWN' {
  if (event.startsWith('PAYMENT_')) return 'PAYMENT';
  if (event.startsWith('SUBSCRIPTION_')) return 'SUBSCRIPTION';
  if (event.startsWith('TRANSFER_')) return 'TRANSFER';
  if (event.startsWith('ACCOUNT_STATUS')) return 'ACCOUNT_STATUS';
  if (event.startsWith('INVOICE_')) return 'INVOICE';
  if (event.startsWith('INTERNAL_TRANSFER_')) return 'INTERNAL_TRANSFER';
  return 'UNKNOWN';
}

/**
 * Eventos críticos que exigem processamento imediato
 */
export const CRITICAL_PAYMENT_EVENTS: PaymentEvent[] = [
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
];

/**
 * Eventos informativos (não alteram estado)
 */
export const INFO_PAYMENT_EVENTS: PaymentEvent[] = [
  'PAYMENT_BANK_SLIP_VIEWED',
  'PAYMENT_CHECKOUT_VIEWED',
];

/**
 * Verifica se é evento crítico
 */
export function isCriticalEvent(event: string): boolean {
  return CRITICAL_PAYMENT_EVENTS.includes(event as PaymentEvent);
}
