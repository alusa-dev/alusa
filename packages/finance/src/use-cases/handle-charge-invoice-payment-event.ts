import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import {
  isInvoicePaymentPaidEvent,
  isInvoicePaymentSensitiveEvent,
} from '../fiscal/charge-invoice-eligibility';
import {
  resolveChargeInvoiceEmissionPath,
  type ChargeInvoiceEmissionPath,
} from '../fiscal/charge-invoice-emission-path';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { cancelChargeInvoice } from './cancel-charge-invoice';
import { emitChargeInvoice } from './emit-charge-invoice';

export type HandleChargeInvoicePaymentEventInput = {
  contaId: string;
  chargeId?: string | null;
  asaasPaymentId: string;
  event: string;
  providerStatus?: string | null;
  asaasPaymentSubscription?: string | null;
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

async function resolveEmissionPath(input: {
  contaId: string;
  chargeId: string;
  asaasPaymentSubscription?: string | null;
}): Promise<{
  path: ChargeInvoiceEmissionPath;
  cobrancaTipo: string | null;
  subscriptionId: string | null;
  standaloneSubscriptionId: string | null;
}> {
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { id: input.chargeId, contaId: input.contaId },
    select: {
      standaloneSubscriptionId: true,
      standaloneSubscription: {
        select: {
          asaasSubscriptionId: true,
          asaasInvoiceSettingsConfigured: true,
        },
      },
      cobranca: {
        select: {
          matriculaId: true,
          tipo: true,
        },
      },
    },
  });

  if (!charge) {
    return {
      path: 'ALUSA_LOCAL',
      cobrancaTipo: null,
      subscriptionId: null,
      standaloneSubscriptionId: null,
    };
  }

  const subscription = charge.cobranca?.matriculaId
    ? await prisma.subscription.findFirst({
        where: { contaId: input.contaId, matriculaId: charge.cobranca.matriculaId },
        select: {
          asaasSubscriptionId: true,
          asaasInvoiceSettingsConfigured: true,
        },
      })
    : null;

  return {
    path: resolveChargeInvoiceEmissionPath({
      charge,
      subscription,
      asaasPayment: { subscription: input.asaasPaymentSubscription ?? null },
    }),
    cobrancaTipo: charge.cobranca?.tipo ?? null,
    subscriptionId: subscription?.asaasSubscriptionId ?? null,
    standaloneSubscriptionId: charge.standaloneSubscription?.asaasSubscriptionId ?? null,
  };
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

    if (invoice.status === 'PROCESSING_CANCELLATION') {
      return {
        handled: true,
        action: 'SKIPPED',
        invoiceId: invoice.id,
        reason: 'INVOICE_CANCEL_IN_PROGRESS',
      };
    }

    if (invoice.status === 'CANCELED') {
      return {
        handled: true,
        action: 'SKIPPED',
        invoiceId: invoice.id,
        reason: 'INVOICE_ALREADY_CANCELED',
      };
    }

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

  const emissionPath = await resolveEmissionPath({
    contaId: input.contaId,
    chargeId,
    asaasPaymentSubscription: input.asaasPaymentSubscription,
  });

  if (emissionPath.path === 'ASAAS_SUBSCRIPTION_NATIVE') {
    await auditLogService.record({
      contaId: input.contaId,
      actor: { type: 'SYSTEM' },
      action: 'finance.invoice.auto_emit_skipped',
      entity: { type: 'Charge', id: chargeId },
      metadata: {
        event: input.event,
        providerStatus: input.providerStatus ?? null,
        asaasPaymentId: input.asaasPaymentId,
        asaasPaymentSubscription: input.asaasPaymentSubscription ?? null,
        emissionPath: emissionPath.path,
        cobrancaTipo: emissionPath.cobrancaTipo,
        subscriptionId: emissionPath.subscriptionId,
        standaloneSubscriptionId: emissionPath.standaloneSubscriptionId,
        reason: 'SUBSCRIPTION_NATIVE_EMISSION',
      },
    });
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
      asaasPaymentSubscription: input.asaasPaymentSubscription ?? null,
      emissionPath: emissionPath.path,
      cobrancaTipo: emissionPath.cobrancaTipo,
      error: emitted.error,
    },
  });
    return { handled: true, action: 'REVIEW_REQUIRED', reason: 'AUTO_EMIT_FAILED' };
  }

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'SYSTEM' },
    action: 'finance.invoice.auto_emit_scheduled',
    entity: { type: 'Charge', id: chargeId },
    metadata: {
      event: input.event,
      providerStatus: input.providerStatus ?? null,
      asaasPaymentId: input.asaasPaymentId,
      asaasPaymentSubscription: input.asaasPaymentSubscription ?? null,
      emissionPath: emissionPath.path,
      cobrancaTipo: emissionPath.cobrancaTipo,
      invoiceId: emitted.data.invoice?.id ?? null,
      reason: 'AUTO_EMIT',
    },
  });

  return { handled: true, action: 'AUTO_EMIT', invoiceId: emitted.data.invoice?.id };
}
