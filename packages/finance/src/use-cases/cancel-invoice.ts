import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { cancelInvoice as asaasCancelInvoice, type AsaasInvoiceStatus } from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type CancelInvoiceInput = {
  contaId: string;
  invoiceId: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type CancelInvoiceOutput = {
  invoiceId: string;
  asaasInvoiceId: string;
  status: InvoiceStatus;
  statusUpdatedAt: string;
};

export type CancelInvoiceError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'INVOICE_NAO_ENCONTRADA'
  | 'INVOICE_SEM_ID_ASAAS'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CANCELAR_INVOICE'
  | 'ERRO_INTERNO';

function mapAsaasInvoiceStatusToInternal(status: AsaasInvoiceStatus): InvoiceStatus {
  if (status === 'AUTHORIZED') return 'ISSUED';
  if (status === 'PROCESSING_CANCELLATION') return 'CANCELING';
  if (status === 'CANCELED') return 'CANCELED';
  if (status === 'ERROR' || status === 'CANCELLATION_DENIED') return 'ERROR';
  return 'REQUESTED';
}

export async function cancelInvoice(
  input: CancelInvoiceInput
): Promise<Result<CancelInvoiceOutput, CancelInvoiceError>> {
  try {
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error === 'KYC_NAO_APROVADO' ? 'KYC_NAO_APROVADO' : 'ERRO_INTERNO');

    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, contaId: input.contaId },
      select: { id: true, asaasInvoiceId: true, status: true },
    });

    if (!invoice) return err('INVOICE_NAO_ENCONTRADA');
    if (!invoice.asaasInvoiceId) return err('INVOICE_SEM_ID_ASAAS');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    const asaasInvoice = await asaasCancelInvoice({
      apiKey: credentials.apiKey,
      id: invoice.asaasInvoiceId,
    });

    const nextStatus = mapAsaasInvoiceStatusToInternal(asaasInvoice.status);

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: nextStatus,
        statusUpdatedAt: new Date(),
        pdfUrl: asaasInvoice.pdfUrl ?? null,
        xmlUrl: asaasInvoice.xmlUrl ?? null,
        number: asaasInvoice.number ?? null,
      },
      select: { id: true, asaasInvoiceId: true, status: true, statusUpdatedAt: true },
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

    return ok({
      invoiceId: updated.id,
      asaasInvoiceId: updated.asaasInvoiceId ?? invoice.asaasInvoiceId,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][cancelInvoice]', error);
    return err('ERRO_AO_CANCELAR_INVOICE');
  }
}
