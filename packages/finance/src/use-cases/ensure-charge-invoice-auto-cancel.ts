import { logFinanceOperationalEvent } from '../foundation/operational-log';
import type { InvoiceStatus } from '@prisma/client';

import { isChargePaymentFullyRefunded } from '../fiscal/charge-invoice-eligibility';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { cancelChargeInvoice } from './cancel-charge-invoice';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';

const AUTO_CANCELABLE_INVOICE_STATUSES = new Set<InvoiceStatus>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
]);

export type EnsureChargeInvoiceAutoCancelResult = {
  canceled: boolean;
  synced: boolean;
  skippedReason?: string;
};

/**
 * Cancela NFS-e pendente/emitida quando a cobrança já está estornada localmente
 * mas o side effect fiscal não rodou (webhook perdido, sync parcial, etc.).
 */
export async function ensureChargeInvoiceAutoCancel(input: {
  contaId: string;
  chargeId: string;
}): Promise<EnsureChargeInvoiceAutoCancelResult> {
  const prisma = getFiscalPrisma();

  const charge = await prisma.charge.findFirst({
    where: { id: input.chargeId, contaId: input.contaId },
    select: {
      asaasPaymentId: true,
      status: true,
      asaasStatus: true,
      cobranca: { select: { status: true } },
    },
  });

  if (!charge?.asaasPaymentId) {
    return { canceled: false, synced: false, skippedReason: 'CHARGE_WITHOUT_PAYMENT' };
  }

  if (
    !isChargePaymentFullyRefunded({
      chargeStatus: charge.status,
      cobrancaStatus: charge.cobranca?.status,
      providerStatus: charge.asaasStatus,
    })
  ) {
    return { canceled: false, synced: false, skippedReason: 'PAYMENT_NOT_REFUNDED' };
  }

  const invoice = await prisma.invoice.findFirst({
    where: { contaId: input.contaId, chargeId: input.chargeId },
    select: { id: true, status: true },
  });

  if (!invoice) {
    return { canceled: false, synced: false, skippedReason: 'NO_INVOICE' };
  }

  if (!AUTO_CANCELABLE_INVOICE_STATUSES.has(invoice.status)) {
    return {
      canceled: false,
      synced: invoice.status === 'CANCELED' || invoice.status === 'PROCESSING_CANCELLATION',
      skippedReason: 'INVOICE_NOT_CANCELABLE',
    };
  }

  const initialSync = await syncInvoiceFromProvider({
    contaId: input.contaId,
    chargeId: input.chargeId,
  });
  if (!initialSync.success) {
    logFinanceOperationalEvent({
      severity: 'warn',
      eventName: 'finance.use_cases.ensure_charge_invoice_auto_cancel.degraded',
      error: initialSync,
      throttleMs: 60_000,
    });
  }

  const canceled = await cancelChargeInvoice({
    contaId: input.contaId,
    chargeId: input.chargeId,
    actor: { type: 'SYSTEM' },
  });

  if (!canceled.success) {
    logFinanceOperationalEvent({
      severity: 'error',
      eventName: 'finance.use_cases.ensure_charge_invoice_auto_cancel.failed',
      error: canceled,
      throttleMs: 60_000,
    });
    return { canceled: false, synced: false, skippedReason: 'AUTO_CANCEL_FAILED' };
  }

  const postCancelSync = await syncInvoiceFromProvider({
    contaId: input.contaId,
    chargeId: input.chargeId,
  });
  if (!postCancelSync.success) {
    logFinanceOperationalEvent({
      severity: 'warn',
      eventName: 'finance.use_cases.ensure_charge_invoice_auto_cancel.degraded',
      error: postCancelSync,
      throttleMs: 60_000,
    });
  }

  return { canceled: true, synced: true };
}
