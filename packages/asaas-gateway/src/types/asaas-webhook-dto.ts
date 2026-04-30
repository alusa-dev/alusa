/**
 * DTOs de Webhook do Asaas
 * Tipos dos payloads recebidos nos webhooks
 */

import type { AsaasPaymentStatus } from './asaas-payment-status';
import type { AsaasSubscriptionStatus } from './asaas-subscription-status';

/**
 * Payload de Payment no webhook
 */
export interface AsaasWebhookPayment {
  id: string;
  customer: string;
  value: number;
  netValue: number;
  originalValue?: number;
  status: AsaasPaymentStatus;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  creditDate?: string | null;
  estimatedCreditDate?: string | null;
  description?: string | null;
  externalReference?: string | null;
  billingType: string;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
  bankSlipUrl?: string | null;
  postalService?: boolean;
  deleted?: boolean;
  anticipated?: boolean;
  anticipable?: boolean;
  
  // Campos de assinatura
  subscription?: string | null;
  
  // Campos de parcelamento
  installment?: string | null;
  installmentNumber?: number | null;
  
  // Campos de refund/chargeback
  refundedDate?: string | null;
  chargebackDate?: string | null;
}

/**
 * Payload de Subscription no webhook
 */
export interface AsaasWebhookSubscription {
  id: string;
  customer: string;
  value: number;
  status: AsaasSubscriptionStatus;
  nextDueDate?: string | null;
  cycle?: string;
  description?: string | null;
  externalReference?: string | null;
  billingType: string;
  deleted?: boolean;
}

/**
 * Payload de Transfer no webhook
 */
export interface AsaasWebhookTransfer {
  id: string;
  value: number;
  netValue?: number;
  status: string;
  externalReference?: string | null;
  operationType?: string;
  description?: string | null;
}

/**
 * Payload de Internal Transfer no webhook
 */
export interface AsaasWebhookInternalTransfer {
  id: string;
  value?: number;
  netValue?: number;
  description?: string | null;
  dateCreated?: string | null;
  status?: string;
}

/**
 * Payload completo do webhook do Asaas
 */
export interface AsaasWebhookPayload {
  /** ID único do evento (usar para idempotência) */
  id?: string;
  /** Tipo do evento */
  event: string;
  /** Info adicional */
  additionalInfo?: {
    scheduledDate?: string;
  };
  /** Dados de payment (presente em eventos PAYMENT_*) */
  payment?: AsaasWebhookPayment;
  /** Dados de subscription (presente em eventos SUBSCRIPTION_*) */
  subscription?: AsaasWebhookSubscription;
  /** Dados de transfer (presente em eventos TRANSFER_*) */
  transfer?: AsaasWebhookTransfer;
  /** Dados de transferência interna */
  internalTransfer?: AsaasWebhookInternalTransfer;
}

/**
 * Extrai o eventId do payload (para idempotência)
 */
export function extractEventId(payload: AsaasWebhookPayload): string | null {
  return payload.id ?? null;
}

/**
 * Extrai o externalReference do payload
 */
export function extractExternalReference(payload: AsaasWebhookPayload): string | null {
  if (payload.payment?.externalReference) return payload.payment.externalReference;
  if (payload.subscription?.externalReference) return payload.subscription.externalReference;
  if (payload.transfer?.externalReference) return payload.transfer.externalReference;
  return null;
}

/**
 * Extrai o ID do Asaas do payload principal
 */
export function extractAsaasId(payload: AsaasWebhookPayload): string | null {
  if (payload.payment?.id) return payload.payment.id;
  if (payload.subscription?.id) return payload.subscription.id;
  if (payload.transfer?.id) return payload.transfer.id;
  if (payload.internalTransfer?.id) return payload.internalTransfer.id;
  return null;
}
