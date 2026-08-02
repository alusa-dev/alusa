import type { AsaasInvoice } from '@alusa/asaas';
import type { Prisma } from '@prisma/client';

import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function buildProviderSnapshot(invoice: AsaasInvoice): Prisma.InputJsonObject {
  return toInputJsonObject({
    id: invoice.id,
    status: invoice.status ?? null,
    statusDescription: invoice.statusDescription ?? null,
    customer: invoice.customer ?? null,
    payment: invoice.payment ?? null,
    installment: invoice.installment ?? null,
    type: invoice.type ?? null,
    pdfUrl: invoice.pdfUrl ?? null,
    xmlUrl: invoice.xmlUrl ?? null,
    rpsSerie: invoice.rpsSerie ?? null,
    rpsNumber: invoice.rpsNumber ?? null,
    number: invoice.number ?? null,
    validationCode: invoice.validationCode ?? null,
    value: invoice.value ?? null,
    deductions: invoice.deductions ?? null,
    effectiveDate: invoice.effectiveDate ?? null,
    externalReference: invoice.externalReference ?? null,
    municipalServiceId: invoice.municipalServiceId ?? null,
    municipalServiceCode: invoice.municipalServiceCode ?? null,
    municipalServiceName: invoice.municipalServiceName ?? null,
    taxes: invoice.taxes ?? null,
  });
}

export function buildInvoiceProviderSnapshotUpdate(
  invoice: AsaasInvoice,
): Pick<
  Prisma.InvoiceUpdateInput,
  | 'providerSnapshot'
  | 'providerTaxes'
  | 'rawProviderStatus'
  | 'providerPisCofinsRetentionType'
  | 'providerPisCofinsTaxStatus'
  | 'providerOperationPis'
  | 'providerOperationCofins'
  | 'providerStateIbs'
  | 'providerStateIbsValue'
  | 'providerMunicipalIbs'
  | 'providerMunicipalIbsValue'
  | 'providerCbs'
  | 'providerCbsValue'
  | 'lastReconciledAt'
> {
  const taxes = invoice.taxes;
  return {
    providerSnapshot: buildProviderSnapshot(invoice),
    providerTaxes: taxes ? toInputJsonObject(taxes as unknown as Record<string, unknown>) : undefined,
    rawProviderStatus: invoice.status ?? null,
    providerPisCofinsRetentionType: taxes?.pisCofinsRetentionType ?? null,
    providerPisCofinsTaxStatus: taxes?.pisCofinsTaxStatus ?? null,
    providerOperationPis: taxes?.operationPis ?? null,
    providerOperationCofins: taxes?.operationCofins ?? null,
    providerStateIbs: taxes?.stateIbs ?? null,
    providerStateIbsValue: taxes?.stateIbsValue ?? null,
    providerMunicipalIbs: taxes?.municipalIbs ?? null,
    providerMunicipalIbsValue: taxes?.municipalIbsValue ?? null,
    providerCbs: taxes?.cbs ?? null,
    providerCbsValue: taxes?.cbsValue ?? null,
    lastReconciledAt: new Date(),
  };
}

export async function recordUnknownInvoiceStatusIssue(input: {
  contaId: string;
  invoiceId: string;
  asaasInvoiceId?: string | null;
  rawStatus: string | null | undefined;
  source: 'webhook' | 'sync' | 'schedule' | 'authorize' | 'cancel' | 'reconcile';
  eventId?: string | null;
}) {
  const rawStatus = input.rawStatus?.trim() || 'UNKNOWN';
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: 'INVOICE',
    entityId: input.invoiceId,
    asaasId: input.asaasInvoiceId ?? null,
    issueType: 'INVOICE_UNKNOWN_STATUS',
    severity: 'HIGH',
    localStatus: 'PRESERVED',
    remoteStatus: rawStatus,
    metadata: {
      source: input.source,
      eventId: input.eventId ?? null,
    },
  });
}
