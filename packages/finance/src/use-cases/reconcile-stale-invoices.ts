import { loadAsaasCredentials } from '@alusa/database';
import { listAsaasInvoices } from '@alusa/asaas';
import type { InvoiceOperationStatus, InvoiceStatus, Prisma } from '@prisma/client';

import { resolveChargeInvoiceEmissionPath } from '../fiscal/charge-invoice-emission-path';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { recordInvoiceAuditEvent } from '../fiscal/invoice-audit.service';
import {
  buildInvoiceProviderSnapshotUpdate,
  recordUnknownInvoiceStatusIssue,
} from '../fiscal/provider-invoice-snapshot';
import { mapAsaasInvoiceStatusToInternal } from '../mappers/invoice-status.mapper';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { handleInvoiceWebhook } from '../webhooks/invoice-webhook-handler';
import { emitChargeInvoice } from './emit-charge-invoice';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';
import { syncSubscriptionFiscalSettings } from './sync-subscription-fiscal-settings';

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

type PaidChargeWithoutInvoiceCandidate = {
  id: string;
  contaId: string;
  asaasPaymentId: string | null;
  asaasStatus: string | null;
  status: string;
  createdAt: Date;
  standaloneSubscriptionId: string | null;
  standaloneSubscription: {
    asaasSubscriptionId: string | null;
    asaasInvoiceSettingsConfigured: boolean;
  } | null;
  cobranca: {
    tipo: string;
    status: string;
    matriculaId: string;
  } | null;
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
  paidChargesScanned: number;
  paidChargesRecovered: number;
  paidChargesFailed: number;
  subscriptionSettingsScanned: number;
  subscriptionSettingsSynced: number;
  subscriptionSettingsFailed: number;
  invoices: Array<{
    id: string;
    contaId: string;
    success: boolean;
    status?: InvoiceStatus;
    recovered?: boolean;
    error?: unknown;
  }>;
  paidCharges: Array<{
    id: string;
    contaId: string;
    success: boolean;
    path?: 'ALUSA_LOCAL' | 'ASAAS_SUBSCRIPTION_NATIVE';
    recovered?: boolean;
    skipped?: boolean;
    error?: unknown;
  }>;
};

const PAID_PROVIDER_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function nextBackoffDate(attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempts) * 60 * 1000);
  return new Date(Date.now() + delayMs);
}

function normalizeStatus(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

function isPaidChargeCandidate(candidate: PaidChargeWithoutInvoiceCandidate): boolean {
  if (candidate.status === 'PAID') return true;
  if (candidate.cobranca?.status === 'PAGO') return true;
  const providerStatus = normalizeStatus(candidate.asaasStatus);
  return Boolean(providerStatus && PAID_PROVIDER_STATUSES.has(providerStatus));
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

async function resolveAcademicSubscription(input: {
  contaId: string;
  matriculaId?: string | null;
}) {
  if (!input.matriculaId) return null;
  const prisma = getFiscalPrisma();
  return prisma.subscription.findFirst({
    where: { contaId: input.contaId, matriculaId: input.matriculaId },
    select: {
      asaasSubscriptionId: true,
      asaasInvoiceSettingsConfigured: true,
    },
  });
}

async function recordPaidChargeWithoutInvoiceIssue(input: {
  candidate: PaidChargeWithoutInvoiceCandidate;
  path: 'ALUSA_LOCAL' | 'ASAAS_SUBSCRIPTION_NATIVE';
  reason: string;
}) {
  await upsertFinanceReconciliationIssue({
    contaId: input.candidate.contaId,
    entityType: 'CHARGE',
    entityId: input.candidate.id,
    asaasId: input.candidate.asaasPaymentId,
    issueType: 'PAID_CHARGE_WITHOUT_INVOICE',
    severity: input.path === 'ASAAS_SUBSCRIPTION_NATIVE' ? 'MEDIUM' : 'HIGH',
    localStatus: input.candidate.status,
    remoteStatus: input.candidate.asaasStatus ?? null,
    metadata: {
      source: 'reconcileStaleInvoices',
      reason: input.reason,
      emissionPath: input.path,
      cobrancaTipo: input.candidate.cobranca?.tipo ?? null,
      asaasPaymentId: input.candidate.asaasPaymentId,
    },
  });
}

async function reconcilePaidChargeWithoutInvoice(candidate: PaidChargeWithoutInvoiceCandidate) {
  if (!candidate.asaasPaymentId) {
    return { success: false as const, error: 'CHARGE_SEM_ASAAS_PAYMENT_ID' };
  }

  const subscription = await resolveAcademicSubscription({
    contaId: candidate.contaId,
    matriculaId: candidate.cobranca?.matriculaId,
  });
  const path = resolveChargeInvoiceEmissionPath({
    charge: candidate,
    subscription,
  });

  if (path === 'ALUSA_LOCAL') {
    const emitted = await emitChargeInvoice({
      contaId: candidate.contaId,
      chargeId: candidate.id,
      actor: { type: 'SYSTEM' },
    });

    if (!emitted.success) {
      await recordPaidChargeWithoutInvoiceIssue({
        candidate,
        path,
        reason: typeof emitted.error === 'string' ? emitted.error : 'AUTO_EMIT_FAILED',
      });
      return { success: false as const, path, error: emitted.error };
    }

    return { success: true as const, path, recovered: true as const };
  }

  const credentials = await loadAsaasCredentials(candidate.contaId);
  if (!credentials) {
    await recordPaidChargeWithoutInvoiceIssue({
      candidate,
      path,
      reason: 'Credenciais Asaas ausentes para consultar nota fiscal nativa.',
    });
    return { success: false as const, path, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' };
  }

  const response = await listAsaasInvoices({
    apiKey: credentials.apiKey,
    payment: candidate.asaasPaymentId,
    limit: 10,
  });
  const found =
    response.data?.find((invoice) => invoice.payment === candidate.asaasPaymentId) ??
    response.data?.[0] ??
    null;

  if (!found) {
    await recordPaidChargeWithoutInvoiceIssue({
      candidate,
      path,
      reason: 'Pagamento confirmado sem NFS-e encontrada no Asaas por payment.',
    });
    return { success: true as const, path, skipped: true as const, recovered: false as const };
  }

  const result = await handleInvoiceWebhook(candidate.contaId, {
    event: 'INVOICE_CREATED',
    invoice: {
      id: found.id,
      status: found.status,
      statusDescription: found.statusDescription ?? null,
      externalReference: found.externalReference ?? null,
      pdfUrl: found.pdfUrl ?? null,
      xmlUrl: found.xmlUrl ?? null,
      number: found.number ?? null,
      serviceDescription: found.serviceDescription ?? null,
      observations: found.observations ?? null,
      value: found.value,
      deductions: found.deductions,
      effectiveDate: found.effectiveDate ?? null,
      payment: found.payment ?? candidate.asaasPaymentId,
      taxes: found.taxes ? { ...found.taxes } : null,
    },
  });

  return {
    success: true as const,
    path,
    recovered: Boolean(result.invoiceId && !result.skipped),
    skipped: Boolean(result.skipped),
  };
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

  const paidChargeCandidates = await prisma.charge.findMany({
    where: {
      contaId: input.contaId,
      asaasPaymentId: { not: null },
      conta: {
        contaFiscalSettings: {
          is: {
            emissionMode: 'ON_PAYMENT',
            readinessStatus: 'READY',
          },
        },
      },
      AND: [
        {
          OR: [
            { status: 'PAID' },
            { asaasStatus: { in: Array.from(PAID_PROVIDER_STATUSES) } },
            { cobranca: { status: 'PAGO' } },
          ],
        },
        {
          OR: [
            { invoice: { is: null } },
            { invoice: { is: { status: 'ERROR' } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      contaId: true,
      asaasPaymentId: true,
      asaasStatus: true,
      status: true,
      createdAt: true,
      standaloneSubscriptionId: true,
      standaloneSubscription: {
        select: {
          asaasSubscriptionId: true,
          asaasInvoiceSettingsConfigured: true,
        },
      },
      cobranca: {
        select: {
          tipo: true,
          status: true,
          matriculaId: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const [academicFiscalSync, standaloneFiscalSync] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        contaId: input.contaId,
        asaasSubscriptionId: { not: null },
        fiscalInvoiceSettingsError: { not: null },
        status: { in: ['REQUESTED', 'ACTIVE'] },
      },
      select: { id: true, contaId: true, asaasSubscriptionId: true },
      take: limit,
    }),
    prisma.standaloneSubscription.findMany({
      where: {
        contaId: input.contaId,
        asaasSubscriptionId: { not: null },
        fiscalInvoiceSettingsError: { not: null },
        status: { in: ['REQUESTED', 'ACTIVE'] },
      },
      select: { id: true, contaId: true, asaasSubscriptionId: true },
      take: limit,
    }),
  ]);

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      candidate,
      result: await reconcileCandidate(candidate),
    })),
  );

  const paidChargeResults = await Promise.allSettled(
    paidChargeCandidates.filter(isPaidChargeCandidate).map(async (candidate) => ({
      candidate,
      result: await reconcilePaidChargeWithoutInvoice(candidate),
    })),
  );

  const subscriptionSettingsResults = await Promise.allSettled([
    ...academicFiscalSync.map((subscription) =>
      syncSubscriptionFiscalSettings({
        contaId: subscription.contaId,
        subscriptionId: subscription.id,
        asaasSubscriptionId: subscription.asaasSubscriptionId!,
        kind: 'ACADEMIC',
        actor: { type: 'SYSTEM' },
      }),
    ),
    ...standaloneFiscalSync.map((subscription) =>
      syncSubscriptionFiscalSettings({
        contaId: subscription.contaId,
        subscriptionId: subscription.id,
        asaasSubscriptionId: subscription.asaasSubscriptionId!,
        kind: 'STANDALONE',
        actor: { type: 'SYSTEM' },
      }),
    ),
  ]);

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

  const filteredPaidChargeCandidates = paidChargeCandidates.filter(isPaidChargeCandidate);
  const reconciledPaidCharges = paidChargeResults.map((item, index) => {
    const candidate = filteredPaidChargeCandidates[index]!;
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
        path: item.value.result.path,
        error: item.value.result.error,
      };
    }

    return {
      id: candidate.id,
      contaId: candidate.contaId,
      success: true,
      path: item.value.result.path,
      recovered: item.value.result.recovered,
      skipped: item.value.result.skipped,
    };
  });

  const subscriptionSettingsFailed = subscriptionSettingsResults.filter(
    (item) => item.status === 'rejected' || !item.value.success,
  ).length;

  return {
    scanned: candidates.length,
    synced: reconciled.filter((item) => item.success).length,
    failed: reconciled.filter((item) => !item.success).length,
    recovered: reconciled.filter((item) => item.success && item.recovered).length,
    paidChargesScanned: paidChargeCandidates.length,
    paidChargesRecovered: reconciledPaidCharges.filter((item) => item.success && item.recovered).length,
    paidChargesFailed: reconciledPaidCharges.filter((item) => !item.success).length,
    subscriptionSettingsScanned: subscriptionSettingsResults.length,
    subscriptionSettingsSynced: subscriptionSettingsResults.length - subscriptionSettingsFailed,
    subscriptionSettingsFailed,
    invoices: reconciled,
    paidCharges: reconciledPaidCharges,
  };
}
