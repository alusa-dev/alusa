import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  AsaasHttpError,
  createInvoice as asaasCreateInvoice,
  listAsaasInvoices,
} from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export type {
  ScheduleChargeInvoiceInput,
  ScheduleChargeInvoiceOutput,
  ScheduleChargeInvoiceError,
} from './schedule-charge-invoice';

export { scheduleChargeInvoice } from './schedule-charge-invoice';

export type CreateInvoiceInput = {
  contaId: string;
  chargeId: string;
  serviceDescription: string;
  observations: string;
  value: number;
  deductions: number;
  effectiveDate: string;
  municipalServiceCode?: string;
  municipalServiceName: string;
  taxes: {
    retainIss: boolean;
    cofins: number;
    csll: number;
    inss: number;
    ir: number;
    pis: number;
    iss: number;
  };
  updatePayment?: boolean;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type CreateInvoiceOutput = {
  invoiceId: string;
  chargeId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  statusUpdatedAt: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  number: string | null;
  createdAt: string;
};

export type CreateInvoiceError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'CHARGE_NAO_ENCONTRADO'
  | 'CHARGE_SEM_PAGAMENTO_ASAAS'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_INVOICE'
  | 'ERRO_INTERNO';

function buildCanonicalInvoiceExternalReference(invoiceId: string): string {
  return `invoice:${invoiceId}`;
}

function isAmbiguousCreateError(error: unknown): boolean {
  if (error instanceof AsaasHttpError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

/** Legacy manual invoice creation (API /api/finance/invoices). Prefer scheduleChargeInvoice. */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<Result<CreateInvoiceOutput, CreateInvoiceError>> {
  try {
    const prisma = getFiscalPrisma();
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error === 'KYC_NAO_APROVADO' ? 'KYC_NAO_APROVADO' : 'ERRO_INTERNO');

    const charge = await prisma.charge.findFirst({
      where: { id: input.chargeId, contaId: input.contaId },
      select: { id: true, asaasPaymentId: true, cobrancaId: true },
    });

    if (!charge) return err('CHARGE_NAO_ENCONTRADO');
    if (!charge.asaasPaymentId) return err('CHARGE_SEM_PAGAMENTO_ASAAS');

    const existing = await prisma.invoice.findUnique({
      where: { chargeId: charge.id },
      select: {
        id: true,
        chargeId: true,
        externalReference: true,
      asaasInvoiceId: true,
      status: true,
      operationStatus: true,
      operationLeaseExpiresAt: true,
      statusUpdatedAt: true,
      pdfUrl: true,
        xmlUrl: true,
        number: true,
        createdAt: true,
      },
    });

    if (existing?.asaasInvoiceId && existing.status !== 'ERROR') {
      return ok({
        invoiceId: existing.id,
        chargeId: existing.chargeId,
        externalReference: existing.externalReference,
        asaasInvoiceId: existing.asaasInvoiceId,
        status: existing.status,
        statusUpdatedAt: existing.statusUpdatedAt.toISOString(),
        pdfUrl: existing.pdfUrl ?? null,
        xmlUrl: existing.xmlUrl ?? null,
        number: existing.number ?? null,
        createdAt: existing.createdAt.toISOString(),
      });
    }

    const invoiceId = charge.id;
    const externalReference = buildCanonicalInvoiceExternalReference(invoiceId);
    const now = new Date();

    if (
      existing &&
      !existing.asaasInvoiceId &&
      (existing.operationStatus === 'CREATING' || existing.operationStatus === 'RECONCILING') &&
      existing.operationLeaseExpiresAt &&
      existing.operationLeaseExpiresAt > now
    ) {
      return ok({
        invoiceId: existing.id,
        chargeId: existing.chargeId,
        externalReference: existing.externalReference,
        asaasInvoiceId: existing.asaasInvoiceId,
        status: existing.status,
        statusUpdatedAt: existing.statusUpdatedAt.toISOString(),
        pdfUrl: existing.pdfUrl ?? null,
        xmlUrl: existing.xmlUrl ?? null,
        number: existing.number ?? null,
        createdAt: existing.createdAt.toISOString(),
      });
    }

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    if (existing && !existing.asaasInvoiceId) {
      const recovered = await listAsaasInvoices({
        apiKey: credentials.apiKey,
        externalReference,
        limit: 10,
      }).catch(() => null);
      const found =
        recovered?.data?.find((invoice) => invoice.externalReference === externalReference) ??
        recovered?.data?.[0] ??
        null;

      if (found) {
        const nextStatus = mapAsaasInvoiceStatusToInternal(found.status);
        const providerSnapshot = buildInvoiceProviderSnapshotUpdate(found);
        const updated = await prisma.invoice.update({
          where: { id: existing.id },
          data: {
            ...providerSnapshot,
            asaasInvoiceId: found.id,
            status: nextStatus ?? existing.status,
            statusDescription: found.statusDescription ?? null,
            statusUpdatedAt: new Date(),
            pdfUrl: found.pdfUrl ?? null,
            xmlUrl: found.xmlUrl ?? null,
            number: found.number ?? null,
            operationStatus: nextStatus ? 'IDLE' : 'RECONCILING',
            operationLeaseExpiresAt: null,
            nextAttemptAt: nextStatus ? null : new Date(Date.now() + 15 * 60 * 1000),
            fiscalDivergence: !nextStatus,
          },
          select: {
            id: true,
            chargeId: true,
            externalReference: true,
            asaasInvoiceId: true,
            status: true,
            statusUpdatedAt: true,
            pdfUrl: true,
            xmlUrl: true,
            number: true,
            createdAt: true,
          },
        });

        if (!nextStatus) {
          await recordUnknownInvoiceStatusIssue({
            contaId: input.contaId,
            invoiceId: updated.id,
            asaasInvoiceId: found.id,
            rawStatus: found.status,
            source: 'reconcile',
          });
        }

        return ok({
          invoiceId: updated.id,
          chargeId: updated.chargeId,
          externalReference: updated.externalReference,
          asaasInvoiceId: updated.asaasInvoiceId,
          status: updated.status,
          statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
          pdfUrl: updated.pdfUrl ?? null,
          xmlUrl: updated.xmlUrl ?? null,
          number: updated.number ?? null,
          createdAt: updated.createdAt.toISOString(),
        });
      }
    }

    const invoiceRecord = await prisma.invoice.upsert({
      where: { chargeId: charge.id },
      update: {
        externalReference,
        status: 'SCHEDULED',
        statusUpdatedAt: new Date(),
        serviceDescription: input.serviceDescription,
        observations: input.observations,
        taxes: input.taxes,
        value: input.value,
        deductions: input.deductions,
        effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`),
        scheduledAt: new Date(),
        cobrancaId: charge.cobrancaId,
        operationStatus: 'CREATING',
        operationStartedAt: now,
        operationLeaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        operationAttempts: { increment: 1 },
        nextAttemptAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
      },
      create: {
        id: invoiceId,
        contaId: input.contaId,
        chargeId: charge.id,
        externalReference,
        status: 'SCHEDULED',
        serviceDescription: input.serviceDescription,
        observations: input.observations,
        taxes: input.taxes,
        value: input.value,
        deductions: input.deductions,
        effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`),
        scheduledAt: new Date(),
        municipalServiceCode: input.municipalServiceCode,
        municipalServiceName: input.municipalServiceName,
        cobrancaId: charge.cobrancaId,
        operationStatus: 'CREATING',
        operationStartedAt: now,
        operationLeaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        operationAttempts: 1,
      },
      select: { id: true, status: true },
    });

    let asaasInvoice: Awaited<ReturnType<typeof asaasCreateInvoice>>;
    try {
      asaasInvoice = await asaasCreateInvoice({
        apiKey: credentials.apiKey,
        data: {
          payment: charge.asaasPaymentId,
          serviceDescription: input.serviceDescription,
          observations: input.observations,
          externalReference,
          value: input.value,
          deductions: input.deductions,
          effectiveDate: input.effectiveDate,
          municipalServiceCode: input.municipalServiceCode,
          municipalServiceName: input.municipalServiceName,
          updatePayment: input.updatePayment,
          taxes: input.taxes,
        },
      });
    } catch (error) {
      const ambiguous = isAmbiguousCreateError(error);
      await prisma.invoice.update({
        where: { id: invoiceRecord.id },
        data: {
          operationStatus: ambiguous ? 'RECONCILING' : 'FAILED',
          operationLeaseExpiresAt: null,
          nextAttemptAt: ambiguous ? new Date(Date.now() + 15 * 60 * 1000) : null,
          lastErrorKind: ambiguous ? 'AMBIGUOUS' : 'CREATE_FAILED',
          lastErrorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Falha ao criar NFS-e.',
          status: ambiguous ? invoiceRecord.status : 'ERROR',
          statusUpdatedAt: ambiguous ? undefined : new Date(),
          fiscalDivergence: ambiguous,
          errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Falha ao criar NFS-e.',
        },
      });
      throw error;
    }

    const nextStatus = mapAsaasInvoiceStatusToInternal(asaasInvoice.status);
    const safeNextStatus = nextStatus ?? invoiceRecord.status;
    const providerSnapshot = buildInvoiceProviderSnapshotUpdate(asaasInvoice);

    const updated = await prisma.invoice.update({
      where: { id: invoiceRecord.id },
      data: {
        ...providerSnapshot,
        asaasInvoiceId: asaasInvoice.id,
        status: safeNextStatus,
        statusDescription: asaasInvoice.statusDescription ?? null,
        statusUpdatedAt: new Date(),
        pdfUrl: asaasInvoice.pdfUrl ?? null,
        xmlUrl: asaasInvoice.xmlUrl ?? null,
        number: asaasInvoice.number ?? null,
        operationStatus: 'IDLE',
        operationLeaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        fiscalDivergence: !nextStatus,
        errorMessage: safeNextStatus === 'ERROR' ? asaasInvoice.statusDescription ?? 'Erro na emissão' : null,
      },
      select: {
        id: true,
        chargeId: true,
        externalReference: true,
        asaasInvoiceId: true,
        status: true,
        statusUpdatedAt: true,
        pdfUrl: true,
        xmlUrl: true,
        number: true,
        createdAt: true,
      },
    });

    if (!nextStatus) {
      await recordUnknownInvoiceStatusIssue({
        contaId: input.contaId,
        invoiceId: updated.id,
        asaasInvoiceId: asaasInvoice.id,
        rawStatus: asaasInvoice.status,
        source: 'schedule',
      });
    }

    await recordInvoiceAuditEvent({
      contaId: input.contaId,
      invoiceId: updated.id,
      action: 'invoice.scheduled',
      fromStatus: invoiceRecord.status,
      toStatus: updated.status,
      metadata: { asaasInvoiceId: updated.asaasInvoiceId },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.invoice.requested',
      entity: { type: 'Invoice', id: updated.id },
      metadata: {
        chargeId: updated.chargeId,
        externalReference: updated.externalReference,
        asaasInvoiceId: updated.asaasInvoiceId,
        status: updated.status,
      },
    });

    return ok({
      invoiceId: updated.id,
      chargeId: updated.chargeId,
      externalReference: updated.externalReference,
      asaasInvoiceId: updated.asaasInvoiceId,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      pdfUrl: updated.pdfUrl ?? null,
      xmlUrl: updated.xmlUrl ?? null,
      number: updated.number ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][createInvoice]', error);
    return err('ERRO_AO_CRIAR_INVOICE');
  }
}
