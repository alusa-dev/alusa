import type { PaymentStatus as AsaasRawPaymentStatus } from '@alusa/asaas';

import {
  handlePaymentWebhook,
  type PaymentWebhookPayload,
} from '../webhooks/payment-webhook-handler';
import { normalizeAsaasPaymentSnapshotStatus } from '../mappers/asaas-payment-snapshot-status';
import type { PaymentStateSource } from '../state-machine/payment-state-machine';

export type ProviderPaymentSnapshot = {
  id: string;
  status?: string | null;
  value?: number | string | null;
  netValue?: number | string | null;
  originalValue?: number | string | null;
  externalReference?: string | null;
  description?: string | null;
  subscription?: string | null;
  installment?: string | null;
  installmentNumber?: number | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  creditDate?: string | null;
  estimatedCreditDate?: string | null;
  billingType?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  transactionReceiptUrl?: string | null;
  deleted?: boolean | null;
};

export type ApplyProviderPaymentSnapshotInput = {
  contaId: string;
  payment: ProviderPaymentSnapshot;
  eventName?: string;
  eventId?: string | null;
  source?: PaymentStateSource;
  providerOccurredAt?: Date | null;
};

export type ApplyProviderPaymentSnapshotOutput =
  | {
      success: true;
      asaasPaymentId: string;
      paymentStatus: string;
      appliedEvent: string;
      stateChanged: boolean;
      webhookPayload: PaymentWebhookPayload;
    }
  | {
      success: false;
      asaasPaymentId: string;
      paymentStatus: string;
      appliedEvent: string;
      error: string;
      webhookPayload: PaymentWebhookPayload;
    };

const EVENT_BY_STATUS: Record<string, string> = {
  CONFIRMED: 'PAYMENT_CONFIRMED',
  RECEIVED: 'PAYMENT_RECEIVED',
  RECEIVED_IN_CASH: 'PAYMENT_RECEIVED',
  OVERDUE: 'PAYMENT_OVERDUE',
  REFUNDED: 'PAYMENT_REFUNDED',
  REFUND_REQUESTED: 'PAYMENT_REFUND_REQUESTED',
  REFUND_IN_PROGRESS: 'PAYMENT_REFUND_IN_PROGRESS',
  DELETED: 'PAYMENT_DELETED',
  DUNNING_RECEIVED: 'PAYMENT_DUNNING_RECEIVED',
  DUNNING_REQUESTED: 'PAYMENT_DUNNING_REQUESTED',
  CHARGEBACK_REQUESTED: 'PAYMENT_CHARGEBACK_REQUESTED',
  CHARGEBACK_DISPUTE: 'PAYMENT_CHARGEBACK_DISPUTE',
  AWAITING_CHARGEBACK_REVERSAL: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  AWAITING_RISK_ANALYSIS: 'PAYMENT_AWAITING_RISK_ANALYSIS',
  PENDING: 'PAYMENT_UPDATED',
};

function chooseSyntheticEvent(status: string, deleted?: boolean | null): string {
  if (deleted) {
    return 'PAYMENT_DELETED';
  }
  return EVENT_BY_STATUS[status] ?? 'PAYMENT_UPDATED';
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Reaplica o estado oficial do provider pelo mesmo handler dos webhooks.
 * Leituras pontuais do Asaas continuam sendo reconciliação, não uma segunda
 * regra de negócio concorrente para status financeiro.
 */
export async function applyProviderPaymentSnapshot(
  input: ApplyProviderPaymentSnapshotInput,
): Promise<ApplyProviderPaymentSnapshotOutput> {
  const payment = input.payment;
  const effectiveAsaasStatus =
    normalizeAsaasPaymentSnapshotStatus({
      eventName: input.eventName,
      status: payment.status,
      billingType: payment.billingType,
      deleted: payment.deleted,
    }) ?? payment.status ?? 'PENDING';
  const appliedEvent = input.eventName ?? chooseSyntheticEvent(effectiveAsaasStatus, payment.deleted);
  const value = toNumber(payment.value);
  const webhookPayload: PaymentWebhookPayload = {
    event: appliedEvent,
    eventId: input.eventId ?? null,
    source: input.source ?? 'RECONCILIATION',
    providerOccurredAt: input.providerOccurredAt ?? null,
    payment: {
      id: payment.id,
      status: effectiveAsaasStatus as AsaasRawPaymentStatus,
      value,
      netValue: toNumber(payment.netValue, value),
      originalValue: payment.originalValue == null ? null : toNumber(payment.originalValue),
      externalReference: payment.externalReference ?? undefined,
      description: payment.description ?? null,
      subscription: payment.subscription ?? null,
      installment: payment.installment ?? null,
      installmentNumber: payment.installmentNumber ?? null,
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? null,
      clientPaymentDate: payment.clientPaymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      billingType: payment.billingType ?? null,
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
      transactionReceiptUrl: payment.transactionReceiptUrl ?? null,
      deleted: payment.deleted ?? false,
    },
  };

  const result = await handlePaymentWebhook(input.contaId, webhookPayload);

  if (!result.success) {
    return {
      success: false,
      asaasPaymentId: payment.id,
      paymentStatus: effectiveAsaasStatus,
      appliedEvent,
      error: result.error ?? 'SYNC_FAILED',
      webhookPayload,
    };
  }

  return {
    success: true,
    asaasPaymentId: payment.id,
    paymentStatus: effectiveAsaasStatus,
    appliedEvent,
    stateChanged: result.stateChanged === true,
    webhookPayload,
  };
}
