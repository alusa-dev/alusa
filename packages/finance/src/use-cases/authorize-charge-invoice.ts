import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { AsaasHttpError, authorizeInvoice as asaasAuthorizeInvoice, getInvoice as asaasGetInvoice } from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type AuthorizeChargeInvoiceInput = {
  contaId: string;
  invoiceId?: string;
  chargeId?: string;
  cobrancaId?: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type AuthorizeChargeInvoiceOutput = {
  invoiceId: string;
  status: InvoiceStatus;
  statusUpdatedAt: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  number: string | null;
};

export type AuthorizeChargeInvoiceError =
  | 'INVOICE_NAO_ENCONTRADA'
  | 'INVOICE_SEM_ID_ASAAS'
  | 'INVOICE_NAO_EMITIVEL'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_EMITIR_INVOICE'
  | 'ERRO_INTERNO'
  | { kind: 'ASAAS'; message: string; status: number };

const AUTHORIZABLE_STATUSES = new Set<InvoiceStatus>(['SCHEDULED']);

function authorizeBlockedMessage(status: InvoiceStatus): string {
  switch (status) {
    case 'SYNCHRONIZED':
      return 'Esta nota já foi enviada à prefeitura e está aguardando autorização. Use "Atualizar status" para acompanhar.';
    case 'AUTHORIZED':
      return 'Esta nota fiscal já foi emitida.';
    case 'PROCESSING_CANCELLATION':
      return 'Esta nota está com cancelamento em processamento.';
    case 'CANCELED':
      return 'Esta nota fiscal já foi cancelada.';
    case 'CANCELLATION_DENIED':
      return 'O cancelamento desta nota foi negado pela prefeitura.';
    case 'ERROR':
      return 'Esta nota está com erro na emissão. Corrija os dados e tente novamente.';
    default:
      return 'Esta nota não está em um status que permite emissão antecipada.';
  }
}

async function persistInvoiceFromAsaas(
  input: {
    contaId: string;
    invoiceId: string;
    currentStatus: InvoiceStatus;
    asaasInvoice: Awaited<ReturnType<typeof asaasGetInvoice>>;
    source: 'authorize' | 'sync';
  },
) {
  const prisma = getFiscalPrisma();
  const nextStatus = mapAsaasInvoiceStatusToInternal(input.asaasInvoice.status);
  const safeNextStatus = nextStatus ?? input.currentStatus;
  const updated = await prisma.invoice.update({
    where: { id: input.invoiceId },
    data: {
      ...buildInvoiceProviderSnapshotUpdate(input.asaasInvoice),
      status: safeNextStatus,
      statusDescription: input.asaasInvoice.statusDescription ?? null,
      statusUpdatedAt: new Date(),
      pdfUrl: input.asaasInvoice.pdfUrl ?? null,
      xmlUrl: input.asaasInvoice.xmlUrl ?? null,
      number: input.asaasInvoice.number ?? null,
      fiscalDivergence: !nextStatus,
      errorMessage:
        safeNextStatus === 'ERROR' ? input.asaasInvoice.statusDescription ?? 'Erro na emissão' : null,
    },
    select: {
      id: true,
      asaasInvoiceId: true,
      status: true,
      statusUpdatedAt: true,
      pdfUrl: true,
      xmlUrl: true,
      number: true,
    },
  });

  if (!nextStatus) {
    await recordUnknownInvoiceStatusIssue({
      contaId: input.contaId,
      invoiceId: updated.id,
      asaasInvoiceId: updated.asaasInvoiceId,
      rawStatus: input.asaasInvoice.status,
      source: input.source,
    });
  }

  return updated;
}

async function resolveInvoice(input: AuthorizeChargeInvoiceInput) {
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

export async function authorizeChargeInvoice(
  input: AuthorizeChargeInvoiceInput,
): Promise<Result<AuthorizeChargeInvoiceOutput, AuthorizeChargeInvoiceError>> {
  try {
    const invoice = await resolveInvoice(input);
    if (!invoice) return err('INVOICE_NAO_ENCONTRADA');
    if (!invoice.asaasInvoiceId) return err('INVOICE_SEM_ID_ASAAS');
    if (!AUTHORIZABLE_STATUSES.has(invoice.status)) {
      return err({
        kind: 'ASAAS',
        message: authorizeBlockedMessage(invoice.status),
        status: 409,
      });
    }

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    const remoteInvoice = await asaasGetInvoice({
      apiKey: credentials.apiKey,
      id: invoice.asaasInvoiceId,
    });
    const remoteStatus = mapAsaasInvoiceStatusToInternal(remoteInvoice.status);

    if (!remoteStatus) {
      await persistInvoiceFromAsaas({
        contaId: input.contaId,
        invoiceId: invoice.id,
        currentStatus: invoice.status,
        asaasInvoice: remoteInvoice,
        source: 'sync',
      });
      return err({
        kind: 'ASAAS',
        message:
          'O Asaas retornou um status fiscal ainda não reconhecido pela Alusa. A nota foi marcada para revisão e não foi autorizada automaticamente.',
        status: 409,
      });
    }

    if (remoteStatus !== 'SCHEDULED') {
      await persistInvoiceFromAsaas({
        contaId: input.contaId,
        invoiceId: invoice.id,
        currentStatus: invoice.status,
        asaasInvoice: remoteInvoice,
        source: 'sync',
      });
      return err({
        kind: 'ASAAS',
        message: authorizeBlockedMessage(remoteStatus),
        status: 409,
      });
    }

    const asaasInvoice = await asaasAuthorizeInvoice({
      apiKey: credentials.apiKey,
      id: invoice.asaasInvoiceId,
    });

    const updated = await persistInvoiceFromAsaas({
      contaId: input.contaId,
      invoiceId: invoice.id,
      currentStatus: invoice.status,
      asaasInvoice,
      source: 'authorize',
    });

    await recordInvoiceAuditEvent({
      contaId: input.contaId,
      invoiceId: updated.id,
      action: 'invoice.authorized',
      fromStatus: invoice.status,
      toStatus: updated.status,
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.invoice.authorized',
      entity: { type: 'Invoice', id: updated.id },
      metadata: {
        asaasInvoiceId: invoice.asaasInvoiceId,
        status: updated.status,
        previousStatus: invoice.status,
      },
    });

    return ok({
      invoiceId: updated.id,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      pdfUrl: updated.pdfUrl ?? null,
      xmlUrl: updated.xmlUrl ?? null,
      number: updated.number ?? null,
    });
  } catch (error) {
    console.error('[finance][authorizeChargeInvoice]', error);
    if (error instanceof AsaasHttpError) {
      if (error.status === 409) {
        return err({
          kind: 'ASAAS',
          message:
            extractAsaasErrorMessage(error) ||
            'Esta nota já saiu do status agendado e não pode ser antecipada. Use "Atualizar status".',
          status: error.status,
        });
      }
      return err({
        kind: 'ASAAS',
        message: extractAsaasErrorMessage(error),
        status: error.status,
      });
    }
    return err('ERRO_AO_EMITIR_INVOICE');
  }
}
