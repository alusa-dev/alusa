import type { InvoiceStatus, Prisma } from '@prisma/client';

import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import { recordUnknownInvoiceStatusIssue } from '../fiscal/provider-invoice-snapshot';
import {
  isAllowedInvoiceStatusTransition,
  mapAsaasInvoiceStatusToInternal,
  mapInvoiceWebhookEventToStatus,
} from '../mappers/invoice-status.mapper';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
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
    taxes?: {
      pisCofinsRetentionType?: string | null;
      pisCofinsTaxStatus?: string | null;
      operationPis?: number | null;
      operationCofins?: number | null;
      [key: string]: unknown;
    } | null;
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

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function buildWebhookProviderUpdate(invoicePayload: NonNullable<InvoiceWebhookPayload['invoice']>) {
  return {
    providerSnapshot: toJsonObject(invoicePayload as unknown as Record<string, unknown>),
    providerTaxes: invoicePayload.taxes
      ? toJsonObject(invoicePayload.taxes as unknown as Record<string, unknown>)
      : undefined,
    rawProviderStatus: invoicePayload.status ?? null,
    providerPisCofinsRetentionType: invoicePayload.taxes?.pisCofinsRetentionType ?? null,
    providerPisCofinsTaxStatus: invoicePayload.taxes?.pisCofinsTaxStatus ?? null,
    providerOperationPis: invoicePayload.taxes?.operationPis ?? null,
    providerOperationCofins: invoicePayload.taxes?.operationCofins ?? null,
    lastReconciledAt: new Date(),
  };
}

async function recordInvoiceStatusDriftIssue(input: {
  contaId: string;
  invoiceId: string;
  asaasInvoiceId?: string | null;
  fromStatus: InvoiceStatus;
  toStatus: InvoiceStatus;
  event: string;
  eventId?: string | null;
}) {
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: 'INVOICE',
    entityId: input.invoiceId,
    asaasId: input.asaasInvoiceId ?? null,
    issueType: 'INVOICE_STATUS_DRIFT',
    severity: 'HIGH',
    localStatus: input.fromStatus,
    remoteStatus: input.toStatus,
    metadata: {
      event: input.event,
      eventId: input.eventId ?? null,
      reason: 'Webhook fiscal fora de ordem ou regressivo bloqueado.',
    },
  });
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
    const hasUnknownRawStatus = Boolean(invoicePayload.status && !payloadStatus);
    const nextStatus = hasUnknownRawStatus ? eventStatus : payloadStatus ?? eventStatus;

    if (!nextStatus) {
      await upsertFinanceReconciliationIssue({
        contaId,
        entityType: 'INVOICE',
        entityId: charge.id,
        asaasId: invoicePayload.id,
        issueType: 'INVOICE_UNKNOWN_STATUS',
        severity: 'HIGH',
        localStatus: null,
        remoteStatus: invoicePayload.status ?? payload.event,
        metadata: {
          source: 'webhook',
          event: payload.event,
          eventId: payload.id ?? null,
          reason: 'Webhook fiscal sem status interno resolvivel.',
        },
      });
      return { handled: true, skipped: true, reason: 'UNKNOWN_PROVIDER_STATUS' };
    }
    const invoiceId = charge.id;
    const providerUpdate = buildWebhookProviderUpdate(invoicePayload);

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
        ...providerUpdate,
        fiscalDivergence: hasUnknownRawStatus,
        operationStatus: nextStatus === 'ERROR' ? 'FAILED' : 'IDLE',
        operationLeaseExpiresAt: null,
        nextAttemptAt: null,
        errorMessage:
          nextStatus === 'ERROR'
            ? invoicePayload.statusDescription ?? 'Erro na emissão fiscal'
            : null,
      },
      update: {
        asaasInvoiceId: invoicePayload.id,
        status: nextStatus,
        ...providerUpdate,
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
        fiscalDivergence: hasUnknownRawStatus,
        operationStatus: nextStatus === 'ERROR' ? 'FAILED' : 'IDLE',
        operationLeaseExpiresAt: null,
        nextAttemptAt: nextStatus === 'ERROR' ? undefined : null,
        errorMessage:
          nextStatus === 'ERROR'
            ? invoicePayload.statusDescription ?? 'Erro na emissão fiscal'
            : nextStatus === 'AUTHORIZED'
              ? null
              : undefined,
      },
    });

    if (hasUnknownRawStatus) {
      await recordUnknownInvoiceStatusIssue({
        contaId,
        invoiceId: invoice.id,
        asaasInvoiceId: invoicePayload.id,
        rawStatus: invoicePayload.status,
        source: 'webhook',
        eventId: payload.id,
      });
    }

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
  const hasUnknownRawStatus = Boolean(invoicePayload.status && !payloadStatus);
  const providerUpdate = buildWebhookProviderUpdate(invoicePayload);

  if (hasUnknownRawStatus) {
    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        asaasInvoiceId: invoice.asaasInvoiceId ?? invoicePayload.id,
        ...providerUpdate,
        fiscalDivergence: true,
      },
    });

    await recordUnknownInvoiceStatusIssue({
      contaId,
      invoiceId: invoice.id,
      asaasInvoiceId: invoice.asaasInvoiceId,
      rawStatus: invoicePayload.status,
      source: 'webhook',
      eventId: payload.id,
    });

    await recordInvoiceAuditEvent({
      contaId,
      invoiceId: invoice.id,
      action: 'webhook.invoice_unknown_status',
      fromStatus: invoice.status,
      toStatus: invoice.status,
      metadata: {
        asaasInvoiceId: invoicePayload.id,
        webhookEventId: payload.id,
        rawStatus: invoicePayload.status,
      },
      correlationId: payload.id,
    });

    await publishInvoiceRealtimeUpdate({ contaId, invoiceId: invoice.id });

    return {
      handled: true,
      invoiceId: invoice.id,
      skipped: true,
      reason: 'UNKNOWN_PROVIDER_STATUS',
      previousStatus: invoice.status,
      nextStatus: invoice.status,
    };
  }

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
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        asaasInvoiceId: invoice.asaasInvoiceId ?? invoicePayload.id,
        ...providerUpdate,
        fiscalDivergence: true,
      },
    });
    await recordInvoiceStatusDriftIssue({
      contaId,
      invoiceId: invoice.id,
      asaasInvoiceId: invoice.asaasInvoiceId ?? invoicePayload.id,
      fromStatus: invoice.status,
      toStatus: nextStatus,
      event: payload.event,
      eventId: payload.id,
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
      ...providerUpdate,
      fiscalDivergence: false,
      operationStatus: nextStatus === 'ERROR' ? 'FAILED' : 'IDLE',
      operationLeaseExpiresAt: null,
      nextAttemptAt: nextStatus === 'ERROR' ? undefined : null,
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
