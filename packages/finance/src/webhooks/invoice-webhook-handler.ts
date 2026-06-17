import type { InvoiceStatus } from '@prisma/client';

import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  isAllowedInvoiceStatusTransition,
  mapAsaasInvoiceStatusToInternal,
  mapInvoiceWebhookEventToStatus,
} from '../mappers/invoice-status.mapper';
import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';

export type InvoiceWebhookPayload = {
  event: string;
  id?: string;
  invoice?: {
    id: string;
    status?: string | null;
    statusDescription?: string | null;
    externalReference?: string | null;
    pdfUrl?: string | null;
    xmlUrl?: string | null;
    number?: string | null;
    serviceDescription?: string | null;
    observations?: string | null;
    value?: number;
    deductions?: number;
    effectiveDate?: string | null;
    payment?: string | null;
  };
};

export type InvoiceWebhookResult = {
  handled: boolean;
  invoiceId?: string;
  previousStatus?: InvoiceStatus;
  nextStatus?: InvoiceStatus;
  skipped?: boolean;
  reason?: string;
};

async function publishInvoiceRealtimeUpdate(params: {
  contaId: string;
  invoiceId: string;
  revision?: number;
}) {
  try {
    await publishFinanceEvent({
      contaId: params.contaId,
      type: 'fiscal.invoice.updated',
      entityId: params.invoiceId,
      revision: params.revision ?? Date.now(),
    });
  } catch (error) {
    console.warn('[finance][handleInvoiceWebhook][realtime-publish-failed]', {
      contaId: params.contaId,
      invoiceId: params.invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handleInvoiceWebhook(
  contaId: string,
  payload: InvoiceWebhookPayload,
): Promise<InvoiceWebhookResult> {
  const prisma = getFiscalPrisma();
  const invoicePayload = payload.invoice;
  if (!invoicePayload?.id) {
    return { handled: false, reason: 'MISSING_INVOICE' };
  }

  let invoice = await prisma.invoice.findFirst({
    where: {
      contaId,
      OR: [
        { asaasInvoiceId: invoicePayload.id },
        ...(invoicePayload.externalReference
          ? [{ externalReference: invoicePayload.externalReference }]
          : []),
      ],
    },
  });

  if (!invoice) {
    const charge = invoicePayload.payment
      ? await prisma.charge.findFirst({
          where: { contaId, asaasPaymentId: invoicePayload.payment },
          select: {
            id: true,
            cobrancaId: true,
            cobranca: {
              select: {
                matriculaId: true,
                matricula: {
                  select: { responsavelFinanceiroId: true },
                },
              },
            },
          },
        })
      : null;

    if (!charge) {
      return { handled: true, skipped: true, reason: 'INVOICE_NOT_FOUND_LOCALLY' };
    }

    const eventStatus = mapInvoiceWebhookEventToStatus(payload.event);
    const payloadStatus = invoicePayload.status
      ? mapAsaasInvoiceStatusToInternal(invoicePayload.status)
      : null;
    const nextStatus = payloadStatus ?? eventStatus ?? 'SCHEDULED';
    const invoiceId = charge.id;

    invoice = await prisma.invoice.upsert({
      where: { chargeId: charge.id },
      create: {
        id: invoiceId,
        contaId,
        chargeId: charge.id,
        cobrancaId: charge.cobrancaId,
        matriculaId: charge.cobranca?.matriculaId ?? null,
        responsavelId: charge.cobranca?.matricula?.responsavelFinanceiroId ?? null,
        externalReference: invoicePayload.externalReference ?? `invoice:${invoiceId}`,
        asaasInvoiceId: invoicePayload.id,
        status: nextStatus,
        statusDescription: invoicePayload.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        value: invoicePayload.value ?? null,
        deductions: invoicePayload.deductions ?? null,
        effectiveDate: invoicePayload.effectiveDate
          ? new Date(`${invoicePayload.effectiveDate}T00:00:00.000Z`)
          : null,
        serviceDescription: invoicePayload.serviceDescription ?? null,
        observations: invoicePayload.observations ?? null,
        pdfUrl: invoicePayload.pdfUrl ?? null,
        xmlUrl: invoicePayload.xmlUrl ?? null,
        number: invoicePayload.number ?? null,
        errorMessage:
          nextStatus === 'ERROR'
            ? invoicePayload.statusDescription ?? 'Erro na emissão fiscal'
            : null,
      },
      update: {
        asaasInvoiceId: invoicePayload.id,
        status: nextStatus,
        statusDescription: invoicePayload.statusDescription ?? undefined,
        statusUpdatedAt: new Date(),
        value: invoicePayload.value ?? undefined,
        deductions: invoicePayload.deductions ?? undefined,
        effectiveDate: invoicePayload.effectiveDate
          ? new Date(`${invoicePayload.effectiveDate}T00:00:00.000Z`)
          : undefined,
        serviceDescription: invoicePayload.serviceDescription ?? undefined,
        observations: invoicePayload.observations ?? undefined,
        pdfUrl: invoicePayload.pdfUrl ?? undefined,
        xmlUrl: invoicePayload.xmlUrl ?? undefined,
        number: invoicePayload.number ?? undefined,
        errorMessage:
          nextStatus === 'ERROR'
            ? invoicePayload.statusDescription ?? 'Erro na emissão fiscal'
            : nextStatus === 'AUTHORIZED'
              ? null
              : undefined,
      },
    });

    await recordInvoiceAuditEvent({
      contaId,
      invoiceId: invoice.id,
      action: 'finance.invoice.webhook_upserted',
      fromStatus: null,
      toStatus: nextStatus,
      metadata: { asaasInvoiceId: invoicePayload.id, webhookEventId: payload.id },
      correlationId: payload.id,
    });

    await publishInvoiceRealtimeUpdate({ contaId, invoiceId: invoice.id });

    return {
      handled: true,
      invoiceId: invoice.id,
      previousStatus: undefined,
      nextStatus,
    };
  }

  const eventStatus = mapInvoiceWebhookEventToStatus(payload.event);
  const payloadStatus = invoicePayload.status
    ? mapAsaasInvoiceStatusToInternal(invoicePayload.status)
    : null;
  const nextStatus = payloadStatus ?? eventStatus;

  if (!nextStatus) {
    return { handled: true, invoiceId: invoice.id, skipped: true, reason: 'NO_STATUS_CHANGE' };
  }

  if (!isAllowedInvoiceStatusTransition(invoice.status, nextStatus)) {
    console.warn('[finance][handleInvoiceWebhook][state-regression-blocked]', {
      contaId,
      invoiceId: invoice.id,
      from: invoice.status,
      to: nextStatus,
      event: payload.event,
    });
    return {
      handled: true,
      invoiceId: invoice.id,
      skipped: true,
      reason: 'STATUS_REGRESSION_BLOCKED',
      previousStatus: invoice.status,
      nextStatus,
    };
  }

  const previousStatus = invoice.status;

  invoice = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      asaasInvoiceId: invoice.asaasInvoiceId ?? invoicePayload.id,
      status: nextStatus,
      statusDescription: invoicePayload.statusDescription ?? undefined,
      statusUpdatedAt: new Date(),
      pdfUrl: invoicePayload.pdfUrl ?? undefined,
      xmlUrl: invoicePayload.xmlUrl ?? undefined,
      number: invoicePayload.number ?? undefined,
      serviceDescription: invoicePayload.serviceDescription ?? undefined,
      observations: invoicePayload.observations ?? undefined,
      errorMessage:
        nextStatus === 'ERROR'
          ? invoicePayload.statusDescription ?? 'Erro na emissão fiscal'
          : nextStatus === 'AUTHORIZED'
            ? null
            : undefined,
    },
  });

  if (previousStatus !== nextStatus) {
    await recordInvoiceAuditEvent({
      contaId,
      invoiceId: invoice.id,
      action: `webhook.${payload.event}`,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      metadata: { asaasInvoiceId: invoicePayload.id, webhookEventId: payload.id },
      correlationId: payload.id,
    });
  }

  await publishInvoiceRealtimeUpdate({ contaId, invoiceId: invoice.id });

  return {
    handled: true,
    invoiceId: invoice.id,
    previousStatus,
    nextStatus,
  };
}
