import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import {
  isInvoicePaymentPaidEvent,
  isInvoicePaymentSensitiveEvent,
} from '../fiscal/charge-invoice-eligibility';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { cancelChargeInvoice } from './cancel-charge-invoice';
import { emitChargeInvoice } from './emit-charge-invoice';

export type HandleChargeInvoicePaymentEventInput = {
  contaId: string;
  chargeId?: string | null;
  asaasPaymentId: string;
  event: string;
  providerStatus?: string | null;
};

export type HandleChargeInvoicePaymentEventOutput = {
  handled: boolean;
  action?: 'AUTO_EMIT' | 'AUTO_CANCEL' | 'REVIEW_REQUIRED' | 'SKIPPED';
  invoiceId?: string;
  reason?: string;
};

const AUTO_CANCELABLE_STATUSES = new Set<InvoiceStatus>(['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED']);

async function resolveChargeId(input: HandleChargeInvoicePaymentEventInput): Promise<string | null> {
  if (input.chargeId) return input.chargeId;
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { contaId: input.contaId, asaasPaymentId: input.asaasPaymentId },
    select: { id: true },
  });
  return charge?.id ?? null;
}

async function hasNativeSubscriptionInvoiceSettings(contaId: string, chargeId: string): Promise<boolean> {
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { id: chargeId, contaId },
    select: {
      standaloneSubscription: {
        select: { asaasInvoiceSettingsConfigured: true },
      },
      cobranca: {
        select: {
          matriculaId: true,
        },
      },
    },
  });

  if (charge?.standaloneSubscription?.asaasInvoiceSettingsConfigured) return true;

  if (charge?.cobranca?.matriculaId) {
    const subscription = await prisma.subscription.findFirst({
      where: { contaId, matriculaId: charge.cobranca.matriculaId },
      select: { asaasInvoiceSettingsConfigured: true },
    });
    return Boolean(subscription?.asaasInvoiceSettingsConfigured);
  }

  return false;
}

export async function handleChargeInvoicePaymentEvent(
  input: HandleChargeInvoicePaymentEventInput,
): Promise<HandleChargeInvoicePaymentEventOutput> {
  const chargeId = await resolveChargeId(input);
  if (!chargeId) return { handled: false, reason: 'CHARGE_NOT_FOUND' };

  const prisma = getFiscalPrisma();
  const [settings, invoice] = await Promise.all([
    prisma.contaFiscalSettings.findUnique({
      where: { contaId: input.contaId },
      select: { emissionMode: true },
    }),
    prisma.invoice.findFirst({
      where: { contaId: input.contaId, chargeId },
      select: { id: true, status: true, asaasInvoiceId: true },
    }),
  ]);

  if (isInvoicePaymentSensitiveEvent(input.event, input.providerStatus)) {
    if (!invoice) return { handled: true, action: 'SKIPPED', reason: 'NO_INVOICE' };

    if (!AUTO_CANCELABLE_STATUSES.has(invoice.status)) {
      await auditLogService.record({
        contaId: input.contaId,
        actor: { type: 'SYSTEM' },
        action: 'finance.invoice.payment_sensitive_review_required',
        entity: { type: 'Invoice', id: invoice.id },
        metadata: {
          event: input.event,
          providerStatus: input.providerStatus ?? null,
          asaasPaymentId: input.asaasPaymentId,
          invoiceStatus: invoice.status,
          reason: 'INVOICE_NOT_AUTO_CANCELABLE',
        },
      });
      return {
        handled: true,
        action: 'REVIEW_REQUIRED',
        invoiceId: invoice.id,
        reason: 'INVOICE_NOT_AUTO_CANCELABLE',
      };
    }

    const canceled = await cancelChargeInvoice({
      contaId: input.contaId,
      chargeId,
      actor: { type: 'SYSTEM' },
    });

    if (!canceled.success) {
      await auditLogService.record({
        contaId: input.contaId,
        actor: { type: 'SYSTEM' },
        action: 'finance.invoice.auto_cancel_failed',
        entity: { type: 'Invoice', id: invoice.id },
        metadata: {
          event: input.event,
          providerStatus: input.providerStatus ?? null,
          asaasPaymentId: input.asaasPaymentId,
          invoiceStatus: invoice.status,
          error: canceled.error,
        },
      });
      return { handled: true, action: 'REVIEW_REQUIRED', invoiceId: invoice.id, reason: 'AUTO_CANCEL_FAILED' };
    }

    return { handled: true, action: 'AUTO_CANCEL', invoiceId: invoice.id };
  }

  if (!isInvoicePaymentPaidEvent(input.event, input.providerStatus)) {
    return { handled: true, action: 'SKIPPED', reason: 'PAYMENT_NOT_PAID_EVENT' };
  }

  if (settings?.emissionMode !== 'ON_PAYMENT') {
    return { handled: true, action: 'SKIPPED', reason: 'AUTO_EMISSION_DISABLED' };
  }

  if (invoice && invoice.status !== 'ERROR') {
    return { handled: true, action: 'SKIPPED', invoiceId: invoice.id, reason: 'INVOICE_ALREADY_EXISTS' };
  }

  if (await hasNativeSubscriptionInvoiceSettings(input.contaId, chargeId)) {
    return {
      handled: true,
      action: 'SKIPPED',
      invoiceId: invoice?.id,
      reason: 'SUBSCRIPTION_NATIVE_EMISSION',
    };
  }

  const emitted = await emitChargeInvoice({
    contaId: input.contaId,
    chargeId,
    actor: { type: 'SYSTEM' },
  });

  if (!emitted.success) {
    await auditLogService.record({
      contaId: input.contaId,
      actor: { type: 'SYSTEM' },
      action: 'finance.invoice.auto_emit_failed',
      entity: { type: 'Charge', id: chargeId },
      metadata: {
        event: input.event,
        providerStatus: input.providerStatus ?? null,
        asaasPaymentId: input.asaasPaymentId,
        error: emitted.error,
      },
    });
    return { handled: true, action: 'REVIEW_REQUIRED', reason: 'AUTO_EMIT_FAILED' };
  }

  return { handled: true, action: 'AUTO_EMIT', invoiceId: emitted.data.invoice?.id };
}
