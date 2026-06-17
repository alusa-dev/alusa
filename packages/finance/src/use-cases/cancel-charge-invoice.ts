import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  cancelInvoice as asaasCancelInvoice,
  AsaasHttpError,
  getMunicipalOptions as asaasGetMunicipalOptions,
} from '@alusa/asaas';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';
import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { FinanceBlockedError } from '../foundation/asaas-operational-guard';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type CancelChargeInvoiceInput = {
  contaId: string;
  invoiceId?: string;
  chargeId?: string;
  cobrancaId?: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type CancelChargeInvoiceOutput = {
  invoiceId: string;
  asaasInvoiceId: string;
  status: InvoiceStatus;
  statusUpdatedAt: string;
};

export type CancelChargeInvoiceError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'INVOICE_NAO_ENCONTRADA'
  | 'INVOICE_SEM_ID_ASAAS'
  | 'INVOICE_NAO_CANCELAVEL'
  | 'INVOICE_CANCELAMENTO_NAO_SUPORTADO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CANCELAR_INVOICE'
  | 'ERRO_INTERNO'
  | { kind: 'ASAAS'; message: string };

function extractAsaasErrorMessage(error: AsaasHttpError): string {
  const responseBody =
    error.responseBody && typeof error.responseBody === 'object'
      ? (error.responseBody as { errors?: Array<{ description?: string }> })
      : null;
  const details =
    responseBody?.errors
      ?.map((item) => item.description)
      .filter((value): value is string => Boolean(value)) ?? [];
  return details.join('; ') || error.message;
}

const CANCELABLE_STATUSES = new Set<InvoiceStatus>(['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED']);

const INVOICE_CANCEL_ALREADY_REQUESTED_STATUSES = new Set<InvoiceStatus>([
  'PROCESSING_CANCELLATION',
  'CANCELED',
]);

function isAsaasInvoiceAlreadyCancelingError(error: AsaasHttpError): boolean {
  const message = extractAsaasErrorMessage(error).toLowerCase();
  return (
    message.includes('processando cancelamento') ||
    message.includes('processing cancellation') ||
    message.includes('processing_cancellation')
  );
}

function toCancelOutput(invoice: {
  id: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: Date;
}): CancelChargeInvoiceOutput {
  return {
    invoiceId: invoice.id,
    asaasInvoiceId: invoice.asaasInvoiceId ?? '',
    status: invoice.status,
    statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
  };
}

async function recordCancelReviewIssue(input: {
  contaId: string;
  invoiceId: string;
  asaasInvoiceId?: string | null;
  localStatus?: InvoiceStatus | null;
  remoteStatus?: string | null;
  reason: string;
}) {
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: 'INVOICE',
    entityId: input.invoiceId,
    asaasId: input.asaasInvoiceId ?? null,
    issueType: 'INVOICE_CANCEL_REVIEW',
    severity: 'HIGH',
    localStatus: input.localStatus ?? null,
    remoteStatus: input.remoteStatus ?? null,
    metadata: {
      reason: input.reason,
      source: 'cancelChargeInvoice',
    },
  });
}

async function resolveInvoice(input: CancelChargeInvoiceInput) {
  const prisma = getFiscalPrisma();
  if (input.invoiceId) {
    return prisma.invoice.findFirst({
      where: { id: input.invoiceId, contaId: input.contaId },
    });
  }
  if (input.chargeId) {
    return prisma.invoice.findFirst({
      where: { chargeId: input.chargeId, contaId: input.contaId },
    });
  }
  if (input.cobrancaId) {
    const charge = await prisma.charge.findFirst({
      where: { cobrancaId: input.cobrancaId, contaId: input.contaId },
      select: { id: true },
    });
    if (!charge) return null;
    return prisma.invoice.findFirst({
      where: { chargeId: charge.id, contaId: input.contaId },
    });
  }
  return null;
}

export async function cancelChargeInvoice(
  input: CancelChargeInvoiceInput,
): Promise<Result<CancelChargeInvoiceOutput, CancelChargeInvoiceError>> {
  try {
    const prisma = getFiscalPrisma();
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    let invoice = await resolveInvoice(input);
    if (!invoice) return err('INVOICE_NAO_ENCONTRADA');
    if (!invoice.asaasInvoiceId) return err('INVOICE_SEM_ID_ASAAS');
    const asaasInvoiceId = invoice.asaasInvoiceId;

    await syncInvoiceFromProvider({
      contaId: input.contaId,
      invoiceId: invoice.id,
    }).catch((error: unknown) => {
      console.warn('[finance][cancelChargeInvoice] pre-cancel sync failed', {
        contaId: input.contaId,
        invoiceId: invoice?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    invoice = (await resolveInvoice(input)) ?? invoice;

    if (INVOICE_CANCEL_ALREADY_REQUESTED_STATUSES.has(invoice.status)) {
      return ok(toCancelOutput(invoice));
    }

    if (!CANCELABLE_STATUSES.has(invoice.status)) return err('INVOICE_NAO_CANCELAVEL');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    try {
      const municipalOptions = await asaasGetMunicipalOptions({ apiKey: credentials.apiKey });
      if (municipalOptions.supportsCancellation === false) {
        await recordCancelReviewIssue({
          contaId: input.contaId,
          invoiceId: invoice.id,
          asaasInvoiceId,
          localStatus: invoice.status,
          remoteStatus: 'CANCELLATION_NOT_SUPPORTED',
          reason: 'Municipio informado pelo Asaas nao suporta cancelamento automatico de NFS-e.',
        });
        return err('INVOICE_CANCELAMENTO_NAO_SUPORTADO');
      }
    } catch (error) {
      console.warn('[finance][cancelChargeInvoice] falha ao verificar suporte municipal', {
        contaId: input.contaId,
        error,
      });
    }

    await ensureWebhookConfigOperational(input.contaId).catch((error: unknown) => {
      if (input.actor.type !== 'SYSTEM' || !(error instanceof FinanceBlockedError)) {
        throw error;
      }
      console.warn('[finance][cancelChargeInvoice] webhook guard bypassed for system cancel', {
        contaId: input.contaId,
        code: error.code,
      });
    });

    const asaasInvoice = await asaasCancelInvoice({
      apiKey: credentials.apiKey,
      id: asaasInvoiceId,
    });

    const nextStatus = mapAsaasInvoiceStatusToInternal(asaasInvoice.status);
    const safeNextStatus = nextStatus ?? invoice.status;

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        ...buildInvoiceProviderSnapshotUpdate(asaasInvoice),
        status: safeNextStatus,
        statusDescription: asaasInvoice.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        pdfUrl: asaasInvoice.pdfUrl ?? null,
        xmlUrl: asaasInvoice.xmlUrl ?? null,
        number: asaasInvoice.number ?? null,
        fiscalDivergence: !nextStatus || safeNextStatus === 'CANCELLATION_DENIED',
      },
      select: { id: true, asaasInvoiceId: true, status: true, statusUpdatedAt: true },
    });

    if (!nextStatus) {
      await recordUnknownInvoiceStatusIssue({
        contaId: input.contaId,
        invoiceId: updated.id,
        asaasInvoiceId: updated.asaasInvoiceId,
        rawStatus: asaasInvoice.status,
        source: 'cancel',
      });
    } else if (nextStatus === 'CANCELLATION_DENIED') {
      await recordCancelReviewIssue({
        contaId: input.contaId,
        invoiceId: updated.id,
        asaasInvoiceId: updated.asaasInvoiceId,
        localStatus: nextStatus,
        remoteStatus: asaasInvoice.status,
        reason: asaasInvoice.statusDescription ?? 'Cancelamento negado pela prefeitura.',
      });
    }

    await recordInvoiceAuditEvent({
      contaId: input.contaId,
      invoiceId: updated.id,
      action: 'invoice.cancel_requested',
      fromStatus: invoice.status,
      toStatus: updated.status,
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.invoice.canceled',
      entity: { type: 'Invoice', id: updated.id },
      metadata: {
        asaasInvoiceId: updated.asaasInvoiceId,
        status: updated.status,
        previousStatus: invoice.status,
      },
    });

    try {
      await publishFinanceEvent({
        contaId: input.contaId,
        type: 'fiscal.invoice.updated',
        entityId: updated.id,
        revision: Date.now(),
      });
    } catch (error) {
      console.warn('[finance][cancelChargeInvoice][realtime-publish-failed]', {
        contaId: input.contaId,
        invoiceId: updated.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return ok({
      invoiceId: updated.id,
      asaasInvoiceId: updated.asaasInvoiceId ?? asaasInvoiceId,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AsaasHttpError && isAsaasInvoiceAlreadyCancelingError(error)) {
      const invoice = await resolveInvoice(input);
      if (invoice) {
        await syncInvoiceFromProvider({
          contaId: input.contaId,
          invoiceId: invoice.id,
        }).catch(() => undefined);

        const refreshed = await resolveInvoice(input);
        if (refreshed && INVOICE_CANCEL_ALREADY_REQUESTED_STATUSES.has(refreshed.status)) {
          console.info('[finance][cancelChargeInvoice] cancel already in progress (idempotent)', {
            contaId: input.contaId,
            invoiceId: refreshed.id,
            status: refreshed.status,
          });
          return ok(toCancelOutput(refreshed));
        }
      }
    }

    console.error('[finance][cancelChargeInvoice]', error);
    if (error instanceof AsaasHttpError) {
      return err({
        kind: 'ASAAS',
        message: extractAsaasErrorMessage(error),
      });
    }
    return err('ERRO_AO_CANCELAR_INVOICE');
  }
}

/** @deprecated Use cancelChargeInvoice */
export const cancelInvoice = cancelChargeInvoice;
export type CancelInvoiceInput = CancelChargeInvoiceInput & { invoiceId: string };
export type CancelInvoiceOutput = CancelChargeInvoiceOutput;
export type CancelInvoiceError = CancelChargeInvoiceError;
