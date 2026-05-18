import type { AsaasPaymentStatus } from '@alusa/asaas-gateway';
import { emitBillingNotificationCandidate } from '@alusa/lib';
import { getPayment, isAsaasEnabled } from './asaas-ops';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { handlePaymentWebhook } from '../webhooks/payment-webhook-handler';

export type SyncPaymentStateFromAsaasInput = {
  contaId: string;
  asaasPaymentId: string;
  eventName?: string;
};

export type SyncPaymentStateFromAsaasOutput =
  | {
      success: true;
      asaasPaymentId: string;
      paymentStatus: string;
      appliedEvent: string;
      invoiceUrl: string | null;
      bankSlipUrl: string | null;
      transactionReceiptUrl: string | null;
    }
  | {
      success: false;
      error: string;
    };

const EVENT_BY_STATUS: Record<string, string> = {
  CONFIRMED: 'PAYMENT_CONFIRMED',
  RECEIVED: 'PAYMENT_RECEIVED',
  RECEIVED_IN_CASH: 'PAYMENT_RECEIVED_IN_CASH',
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

/**
 * Força convergência local consultando o estado atual do pagamento no Asaas
 * e reaplicando o pipeline de webhook internamente (idempotente).
 */
export async function syncPaymentStateFromAsaas(
  input: SyncPaymentStateFromAsaasInput
): Promise<SyncPaymentStateFromAsaasOutput> {
  if (!isAsaasEnabled()) {
    return { success: false, error: 'ASAAS_DISABLED' };
  }

  recordAsaasReadIntent('RECONCILIATION');
  const payment = await getPayment(input.asaasPaymentId, { contaId: input.contaId });
  const appliedEvent = input.eventName ?? chooseSyntheticEvent(payment.status, payment.deleted);

  const webhookResult = await handlePaymentWebhook(input.contaId, {
    event: appliedEvent,
    payment: {
      id: payment.id,
      status: payment.status as AsaasPaymentStatus,
      value: Number(payment.value ?? 0),
      netValue: Number(payment.netValue ?? payment.value ?? 0),
      originalValue: payment.originalValue ?? null,
      externalReference: payment.externalReference ?? undefined,
      description: payment.description ?? null,
      subscription: payment.subscription ?? null,
      installment: payment.installment ?? null,
      installmentNumber: null,
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
  });

  if (!webhookResult.success) {
    return {
      success: false,
      error: webhookResult.error ?? 'SYNC_FAILED',
    };
  }
  void emitBillingNotificationCandidate(
    {
      event: appliedEvent,
      asaasPaymentId: payment.id,
    },
    'ASAAS_SYNC',
  ).catch((error: unknown) => {
    console.warn('[syncPaymentStateFromAsaas] Falha não crítica ao emitir inbox', {
      contaId: input.contaId,
      asaasPaymentId: payment.id,
      appliedEvent,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    success: true,
    asaasPaymentId: payment.id,
    paymentStatus: payment.status,
    appliedEvent,
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
    transactionReceiptUrl: payment.transactionReceiptUrl ?? null,
  };
}
