import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { AsaasHttpError, getInvoice as asaasGetInvoice } from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import {
  isAllowedInvoiceStatusTransition,
  mapAsaasInvoiceStatusToInternal,
} from '../mappers/invoice-status.mapper';

export type SyncInvoiceFromProviderInput = {
  contaId: string;
  invoiceId?: string;
  chargeId?: string;
  cobrancaId?: string;
  correlationId?: string;
};

export type SyncInvoiceFromProviderOutput = {
  invoiceId: string;
  status: InvoiceStatus;
  statusUpdatedAt: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  number: string | null;
};

export type SyncInvoiceFromProviderError =
  | 'INVOICE_NAO_ENCONTRADA'
  | 'INVOICE_SEM_ID_ASAAS'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_SINCRONIZAR_INVOICE'
  | 'ERRO_INTERNO'
  | { kind: 'ASAAS'; message: string; status: number };

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

async function resolveInvoice(input: SyncInvoiceFromProviderInput) {
  const prisma = getFiscalPrisma();
  if (input.invoiceId) {
    return prisma.invoice.findFirst({ where: { id: input.invoiceId, contaId: input.contaId } });
  }
  if (input.chargeId) {
    return prisma.invoice.findFirst({ where: { chargeId: input.chargeId, contaId: input.contaId } });
  }
  if (input.cobrancaId) {
    const charge = await prisma.charge.findFirst({
      where: { cobrancaId: input.cobrancaId, contaId: input.contaId },
      select: { id: true },
    });
    if (!charge) return null;
    return prisma.invoice.findFirst({ where: { chargeId: charge.id, contaId: input.contaId } });
  }
  return null;
}

export async function syncInvoiceFromProvider(
  input: SyncInvoiceFromProviderInput,
): Promise<Result<SyncInvoiceFromProviderOutput, SyncInvoiceFromProviderError>> {
  try {
    const prisma = getFiscalPrisma();
    const invoice = await resolveInvoice(input);
    if (!invoice) return err('INVOICE_NAO_ENCONTRADA');
    if (!invoice.asaasInvoiceId) return err('INVOICE_SEM_ID_ASAAS');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const asaasInvoice = await asaasGetInvoice({
      apiKey: credentials.apiKey,
      id: invoice.asaasInvoiceId,
    });

    const providerSnapshot = buildInvoiceProviderSnapshotUpdate(asaasInvoice);
    const nextStatus = mapAsaasInvoiceStatusToInternal(asaasInvoice.status);
    if (!nextStatus) {
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          ...providerSnapshot,
          fiscalDivergence: true,
          statusDescription: asaasInvoice.statusDescription ?? invoice.statusDescription,
        },
        select: {
          id: true,
          status: true,
          statusUpdatedAt: true,
          pdfUrl: true,
          xmlUrl: true,
          number: true,
        },
      });

      await recordUnknownInvoiceStatusIssue({
        contaId: input.contaId,
        invoiceId: invoice.id,
        asaasInvoiceId: invoice.asaasInvoiceId,
        rawStatus: asaasInvoice.status,
        source: 'sync',
      });

      await recordInvoiceAuditEvent({
        contaId: input.contaId,
        invoiceId: updated.id,
        action: 'invoice.provider_unknown_status',
        fromStatus: invoice.status,
        toStatus: invoice.status,
        metadata: {
          rawProviderStatus: asaasInvoice.status ?? null,
          asaasInvoiceId: invoice.asaasInvoiceId,
        },
        correlationId: input.correlationId,
      });

      return ok({
        invoiceId: updated.id,
        status: updated.status,
        statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
        pdfUrl: updated.pdfUrl ?? null,
        xmlUrl: updated.xmlUrl ?? null,
        number: updated.number ?? null,
      });
    }

    if (!isAllowedInvoiceStatusTransition(invoice.status, nextStatus)) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          ...providerSnapshot,
          fiscalDivergence: true,
        },
      });
      return ok({
        invoiceId: invoice.id,
        status: invoice.status,
        statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
        pdfUrl: invoice.pdfUrl ?? null,
        xmlUrl: invoice.xmlUrl ?? null,
        number: invoice.number ?? null,
      });
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        ...providerSnapshot,
        status: nextStatus,
        statusDescription: asaasInvoice.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        pdfUrl: asaasInvoice.pdfUrl ?? null,
        xmlUrl: asaasInvoice.xmlUrl ?? null,
        number: asaasInvoice.number ?? null,
        fiscalDivergence: false,
        errorMessage: nextStatus === 'ERROR' ? asaasInvoice.statusDescription ?? 'Erro na emissão' : null,
      },
      select: {
        id: true,
        status: true,
        statusUpdatedAt: true,
        pdfUrl: true,
        xmlUrl: true,
        number: true,
      },
    });

    if (updated.status !== invoice.status) {
      await recordInvoiceAuditEvent({
        contaId: input.contaId,
        invoiceId: updated.id,
        action: 'invoice.synced',
        fromStatus: invoice.status,
        toStatus: updated.status,
        correlationId: input.correlationId,
      });
    }

    return ok({
      invoiceId: updated.id,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      pdfUrl: updated.pdfUrl ?? null,
      xmlUrl: updated.xmlUrl ?? null,
      number: updated.number ?? null,
    });
  } catch (error) {
    console.error('[finance][syncInvoiceFromProvider]', error);
    if (error instanceof AsaasHttpError) {
      return err({
        kind: 'ASAAS',
        message: extractAsaasErrorMessage(error),
        status: error.status,
      });
    }
    return err('ERRO_AO_SINCRONIZAR_INVOICE');
  }
}

export async function getChargeInvoiceByCobranca(input: {
  contaId: string;
  cobrancaId: string;
}) {
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { cobrancaId: input.cobrancaId, contaId: input.contaId },
    select: { id: true },
  });
  if (!charge) return null;

  return prisma.invoice.findFirst({
    where: { chargeId: charge.id, contaId: input.contaId },
  });
}
