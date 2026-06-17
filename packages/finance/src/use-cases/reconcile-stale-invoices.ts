import { loadAsaasCredentials } from '@alusa/database';
import { listAsaasInvoices } from '@alusa/asaas';
import type { InvoiceOperationStatus, InvoiceStatus, Prisma } from '@prisma/client';

import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';

const DEFAULT_STALE_MINUTES = 60;
const DEFAULT_LIMIT = 50;
const RECONCILABLE_PROVIDER_STATUSES: InvoiceStatus[] = [
  'SCHEDULED',
  'SYNCHRONIZED',
  'ERROR',
  'PROCESSING_CANCELLATION',
  'CANCELLATION_DENIED',
];
const RECONCILABLE_LOCAL_OPERATIONS: InvoiceOperationStatus[] = ['CREATING', 'RECONCILING', 'FAILED'];

type ReconcileCandidate = {
  id: string;
  contaId: string;
  externalReference: string;
  asaasInvoiceId: string | null;
  status: InvoiceStatus;
  operationStatus: InvoiceOperationStatus;
  operationAttempts: number;
};

export type ReconcileStaleInvoicesInput = {
  contaId?: string;
  limit?: number;
  staleOlderThanMinutes?: number;
};

export type ReconcileStaleInvoicesOutput = {
  scanned: number;
  synced: number;
  failed: number;
  recovered: number;
  invoices: Array<{
    id: string;
    contaId: string;
    success: boolean;
    status?: InvoiceStatus;
    recovered?: boolean;
    error?: unknown;
  }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function nextBackoffDate(attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempts) * 60 * 1000);
  return new Date(Date.now() + delayMs);
}

async function recordProviderLinkMissing(input: {
  contaId: string;
  invoiceId: string;
  externalReference: string;
  localStatus: InvoiceStatus;
  reason: string;
}) {
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: 'INVOICE',
    entityId: input.invoiceId,
    issueType: 'INVOICE_PROVIDER_LINK_MISSING',
    severity: 'MEDIUM',
    localStatus: input.localStatus,
    remoteStatus: 'NOT_FOUND',
    metadata: {
      externalReference: input.externalReference,
      reason: input.reason,
      source: 'reconcileStaleInvoices',
    },
  });
}

async function recoverMissingProviderInvoice(candidate: ReconcileCandidate) {
  const prisma = getFiscalPrisma();
  const credentials = await loadAsaasCredentials(candidate.contaId);
  if (!credentials) {
    await prisma.invoice.update({
      where: { id: candidate.id },
      data: {
        operationStatus: 'FAILED',
        operationLeaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorKind: 'AUTH_CONFIG',
        lastErrorMessage: 'Credenciais Asaas nao configuradas para reconciliar nota fiscal.',
        fiscalDivergence: true,
      },
    });
    await recordProviderLinkMissing({
      contaId: candidate.contaId,
      invoiceId: candidate.id,
      externalReference: candidate.externalReference,
      localStatus: candidate.status,
      reason: 'Credenciais Asaas ausentes durante reconciliacao fiscal.',
    });
    return { success: false as const, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' };
  }

  const response = await listAsaasInvoices({
    apiKey: credentials.apiKey,
    externalReference: candidate.externalReference,
    limit: 10,
  });
  const found =
    response.data?.find((invoice) => invoice.externalReference === candidate.externalReference) ??
    response.data?.[0] ??
    null;

  if (!found) {
    await prisma.invoice.update({
      where: { id: candidate.id },
      data: {
        operationStatus: 'FAILED',
        operationLeaseExpiresAt: null,
        nextAttemptAt: nextBackoffDate(candidate.operationAttempts),
        lastErrorKind: 'PROVIDER_NOT_FOUND',
        lastErrorMessage:
          'Nenhuma nota fiscal foi encontrada no Asaas com a externalReference local.',
        fiscalDivergence: true,
      },
    });
    await recordProviderLinkMissing({
      contaId: candidate.contaId,
      invoiceId: candidate.id,
      externalReference: candidate.externalReference,
      localStatus: candidate.status,
      reason: 'Nota local sem ID externo nao foi encontrada no Asaas por externalReference.',
    });
    return { success: false as const, error: 'INVOICE_NOT_FOUND_ON_PROVIDER' };
  }

  const providerStatus = mapAsaasInvoiceStatusToInternal(found.status);
  const snapshot = buildInvoiceProviderSnapshotUpdate(found);
  const nextStatus = providerStatus ?? candidate.status;
  const data: Prisma.InvoiceUpdateInput = {
    ...snapshot,
    asaasInvoiceId: found.id,
    status: nextStatus,
    statusDescription: found.statusDescription ?? null,
    statusUpdatedAt: new Date(),
    pdfUrl: found.pdfUrl ?? null,
    xmlUrl: found.xmlUrl ?? null,
    number: found.number ?? null,
    operationStatus: providerStatus ? 'IDLE' : 'RECONCILING',
    operationLeaseExpiresAt: null,
    nextAttemptAt: providerStatus ? null : nextBackoffDate(candidate.operationAttempts),
    lastErrorKind: providerStatus ? null : 'UNKNOWN_STATUS',
    lastErrorMessage: providerStatus
      ? null
      : `Status desconhecido retornado pelo Asaas: ${found.status ?? 'UNKNOWN'}`,
    fiscalDivergence: !providerStatus,
    errorMessage: nextStatus === 'ERROR' ? found.statusDescription ?? 'Erro na emissão fiscal' : null,
  };

  const updated = await prisma.invoice.update({
    where: { id: candidate.id },
    data,
    select: { id: true, status: true, asaasInvoiceId: true },
  });

  if (!providerStatus) {
    await recordUnknownInvoiceStatusIssue({
      contaId: candidate.contaId,
      invoiceId: updated.id,
      asaasInvoiceId: updated.asaasInvoiceId,
      rawStatus: found.status,
      source: 'reconcile',
    });
  }

  await recordInvoiceAuditEvent({
    contaId: candidate.contaId,
    invoiceId: candidate.id,
    action: 'invoice.recovered',
    fromStatus: candidate.status,
    toStatus: nextStatus,
    metadata: {
      asaasInvoiceId: found.id,
      externalReference: candidate.externalReference,
      rawProviderStatus: found.status ?? null,
      unknownProviderStatus: !providerStatus,
    },
  });

  return { success: true as const, status: updated.status, recovered: true as const };
}

async function reconcileCandidate(candidate: ReconcileCandidate) {
  if (candidate.asaasInvoiceId) {
    const result = await syncInvoiceFromProvider({
      contaId: candidate.contaId,
      invoiceId: candidate.id,
      correlationId: `reconcile-stale-invoices:${candidate.id}`,
    });

    if (!result.success) {
      return { success: false as const, error: result.error };
    }

    return { success: true as const, status: result.data.status, recovered: false as const };
  }

  return recoverMissingProviderInvoice(candidate);
}

export async function reconcileStaleInvoices(
  input: ReconcileStaleInvoicesInput = {},
): Promise<ReconcileStaleInvoicesOutput> {
  const prisma = getFiscalPrisma();
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, 200);
  const staleOlderThanMinutes = clampInt(
    input.staleOlderThanMinutes,
    DEFAULT_STALE_MINUTES,
    5,
    24 * 60,
  );
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleOlderThanMinutes * 60 * 1000);

  const candidates = await prisma.invoice.findMany({
    where: {
      contaId: input.contaId,
      OR: [
        {
          asaasInvoiceId: { not: null },
          statusUpdatedAt: { lte: staleBefore },
          OR: [
            { status: { in: RECONCILABLE_PROVIDER_STATUSES } },
            { fiscalDivergence: true },
            { lastReconciledAt: null },
          ],
        },
        {
          asaasInvoiceId: null,
          OR: [
            {
              operationStatus: { in: RECONCILABLE_LOCAL_OPERATIONS },
              OR: [
                { operationLeaseExpiresAt: null },
                { operationLeaseExpiresAt: { lte: now } },
              ],
            },
            { nextAttemptAt: { lte: now } },
            {
              status: { in: ['SCHEDULED', 'SYNCHRONIZED', 'ERROR'] },
              statusUpdatedAt: { lte: staleBefore },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      contaId: true,
      externalReference: true,
      asaasInvoiceId: true,
      status: true,
      operationStatus: true,
      operationAttempts: true,
    },
    orderBy: [
      { nextAttemptAt: 'asc' },
      { statusUpdatedAt: 'asc' },
    ],
    take: limit,
  });

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      candidate,
      result: await reconcileCandidate(candidate),
    })),
  );

  const reconciled = results.map((item, index) => {
    const candidate = candidates[index]!;
    if (item.status === 'rejected') {
      return {
        id: candidate.id,
        contaId: candidate.contaId,
        success: false,
        error: item.reason instanceof Error ? item.reason.message : item.reason,
      };
    }

    if (!item.value.result.success) {
      return {
        id: candidate.id,
        contaId: candidate.contaId,
        success: false,
        error: item.value.result.error,
      };
    }

    return {
      id: candidate.id,
      contaId: candidate.contaId,
      success: true,
      status: item.value.result.status,
      recovered: item.value.result.recovered,
    };
  });

  return {
    scanned: candidates.length,
    synced: reconciled.filter((item) => item.success).length,
    failed: reconciled.filter((item) => !item.success).length,
    recovered: reconciled.filter((item) => item.success && item.recovered).length,
    invoices: reconciled,
  };
}
