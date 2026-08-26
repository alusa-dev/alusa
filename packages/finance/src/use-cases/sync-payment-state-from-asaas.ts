import { emitBillingNotificationCandidate } from '@alusa/lib';
import { getPayment, isAsaasEnabled } from './asaas-ops';
import { recordAsaasReadIntent, type AsaasReadIntent } from '../foundation/asaas-read-intent';
import { confirmPaymentCommandsByProviderEvent } from './payment-command-ledger';
import { applyProviderPaymentSnapshot } from './apply-provider-payment-snapshot';

export type SyncPaymentStateFromAsaasInput = {
  contaId: string;
  asaasPaymentId: string;
  eventName?: string;
  intent?: AsaasReadIntent;
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

  recordAsaasReadIntent(input.intent ?? 'RECONCILIATION');
  const payment = await getPayment(input.asaasPaymentId, { contaId: input.contaId });
  const snapshotResult = await applyProviderPaymentSnapshot({
    contaId: input.contaId,
    payment,
    eventName: input.eventName,
  });

  if (!snapshotResult.success) {
    return {
      success: false,
      error: snapshotResult.error,
    };
  }

  await confirmPaymentCommandsByProviderEvent({
    contaId: input.contaId,
    asaasPaymentId: payment.id,
    eventName: snapshotResult.appliedEvent,
    providerStatus: snapshotResult.paymentStatus,
  });

  if (snapshotResult.stateChanged) {
    void emitBillingNotificationCandidate(
      {
        contaId: input.contaId,
        event: snapshotResult.appliedEvent,
        asaasPaymentId: payment.id,
      },
      'ASAAS_SYNC',
    ).catch((error: unknown) => {
      console.warn('[syncPaymentStateFromAsaas] Falha não crítica ao emitir inbox', {
        contaId: input.contaId,
        asaasPaymentId: payment.id,
        appliedEvent: snapshotResult.appliedEvent,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    success: true,
    asaasPaymentId: payment.id,
    paymentStatus: snapshotResult.paymentStatus,
    appliedEvent: snapshotResult.appliedEvent,
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
    transactionReceiptUrl: payment.transactionReceiptUrl ?? null,
  };
}
