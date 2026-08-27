/**
 * Webhook Reconciliation Service
 *
 * Responsável por:
 * - Detectar gaps de eventos (cobranças sem status final)
 * - Reprocessar eventos com erro
 * - Reconciliar estado local com Asaas via API
 *
 * Princípios:
 * - Execução controlada (sem polling agressivo)
 * - Janela de tempo configurável
 * - Fail-safe: erros não travam o processo
 */

import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { ChargeStatus, Prisma } from '@prisma/client';
import { getInstallment, getPayment, getSubscription, listInstallmentPayments, listPayments } from '@alusa/asaas';
import type { AsaasPayment, AsaasSubscription } from '@alusa/asaas';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { alertService } from '../foundation/alert-channel';
import { mapAsaasToChargeStatus } from '../core';
import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { handlePaymentWebhook } from './payment-webhook-handler';
import { handleSubscriptionWebhook } from './subscription-webhook-handler';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { normalizeAsaasPaymentSnapshotStatus } from '../mappers/asaas-payment-snapshot-status';
import { reconcileEnrollmentFeeProjections } from '../projections/enrollment-fee-projection.service';
import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ReconciliationResult {
  startedAt: Date;
  completedAt: Date;
  contaId: string;
  windowDays: number;
  webhooksReprocessed: number;
  webhooksSucceeded: number;
  webhooksFailed: number;
  chargesWithGap: number;
  chargesReconciled: number;
  errors: string[];
}

export interface ReconciliationOptions {
  /** Dias para trás a partir de hoje (default: 7) */
  windowDays?: number;
  /** Limite de webhooks a reprocessar por execução (default: 50) */
  webhookLimit?: number;
  /** Limite de charges a verificar por gap (default: 100) */
  chargeLimit?: number;
  /** Se true, apenas detecta gaps sem reprocessar */
  dryRun?: boolean;
  /** Se true, materializa gaps no read model operacional */
  persistIssues?: boolean;
}

export interface QueueMetricsOptions {
  contaId?: string;
  processingTimeoutMinutes?: number;
}

export interface QueueMetricsResult {
  contaId: string | 'ALL';
  backlog: number;
  pending: number;
  processing: number;
  errored: number;
  processed: number;
  highRetryBacklog: number;
  stuckProcessing: number;
  oldestPendingAt: Date | null;
  lagSeconds: number | null;
  generatedAt: Date;
}

export interface ArchiveWebhooksOptions {
  contaId?: string;
  olderThanDays?: number;
  limit?: number;
}

export interface ArchiveWebhooksResult {
  contaId: string | 'ALL';
  olderThanDays: number;
  selected: number;
  archived: number;
  deletedFromHot: number;
  generatedAt: Date;
}

export interface AsaasReconcileOptions {
  contaId: string;
  /** Janela histórica usada pela detecção de gaps. */
  windowHours?: number;
  limit?: number;
  dryRun?: boolean;
  mode?: 'targeted' | 'safety_sweep';
  /** Intervalo mínimo entre leituras do provedor para o mesmo registro. */
  providerCheckIntervalMinutes?: number;
  /** Orçamento máximo de chamadas externas nesta execução. */
  maxAsaasCalls?: number;
  /** Deadline operacional para esta conta. */
  maxDurationMs?: number;
  correlationId?: string;
}

export interface AsaasReconcileResult {
  contaId: string;
  dryRun: boolean;
  mode: 'targeted' | 'safety_sweep';
  correlationId: string | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  asaasCalls: number;
  maxAsaasCalls: number;
  budgetExhausted: boolean;
  providerCheckIntervalMinutes: number;
  checkedPayments: number;
  reconciledPayments: number;
  paymentDrift: number;
  checkedSubscriptions: number;
  reconciledSubscriptions: number;
  subscriptionDrift: number;
  checkedInstallments: number;
  installmentDrift: number;
  errors: string[];
  generatedAt: Date;
}

export interface WebhookGapDetectionResult {
  chargesWithMissingFinalStatus: Array<{
    id: string;
    asaasPaymentId: string | null;
    status: string;
    dueDate: Date | null;
    lastWebhookAt: Date | null;
  }>;
  subscriptionsWithMissingEvents: Array<{
    id: string;
    asaasSubscriptionId: string | null;
    status: string;
    lastWebhookAt: Date | null;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_CHARGE_LIMIT = 100;
const DEFAULT_ARCHIVE_DAYS = 30;
const DEFAULT_ARCHIVE_LIMIT = 500;
const DEFAULT_RECONCILE_LIMIT = 200;
const DEFAULT_PROVIDER_CHECK_INTERVAL_MINUTES = 6 * 60;
const DEFAULT_SAFETY_SWEEP_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_MAX_ASAAS_CALLS = 100;
const DEFAULT_MAX_RECONCILE_DURATION_MS = 100_000;
const DEFAULT_PROCESSING_TIMEOUT_MINUTES = 5;

/** Status acadêmico (Cobranca) que indicam estado não-final */
const NON_FINAL_STATUSES = ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO'];

/** Status operacional (Charge) que indicam estado não-final — alinhado a financial-read-convergence */
const NON_FINAL_CHARGE_STATUSES: ChargeStatus[] = [
  'CREATED',
  'PENDING_SYNC',
  'OPEN',
  'OVERDUE',
];

const RECONCILE_INFLIGHT_WEBHOOK_STATUSES = ['PENDENTE', 'PROCESSANDO'] as const;

const PAYMENT_EVENT_BY_STATUS: Record<string, string> = {
  PENDING: 'PAYMENT_UPDATED',
  RECEIVED: 'PAYMENT_RECEIVED',
  CONFIRMED: 'PAYMENT_CONFIRMED',
  RECEIVED_IN_CASH: 'PAYMENT_RECEIVED',
  OVERDUE: 'PAYMENT_OVERDUE',
  REFUNDED: 'PAYMENT_REFUNDED',
  REFUND_REQUESTED: 'PAYMENT_REFUND_REQUESTED',
  REFUND_IN_PROGRESS: 'PAYMENT_REFUND_IN_PROGRESS',
  DELETED: 'PAYMENT_DELETED',
};

function resolveRemotePaymentSnapshotStatus(payment: {
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
}): string {
  return (
    normalizeAsaasPaymentSnapshotStatus({
      status: payment.status,
      billingType: payment.billingType,
      deleted: payment.deleted,
    }) ??
    payment.status ??
    'PENDING'
  );
}

type PaymentReconciliationCandidate = {
  entityId: string;
  asaasPaymentId: string;
  localStatus: string;
  persistedAsaasStatus: string | null;
  externalReference: string | null;
  source: 'charge' | 'cobranca';
  lastProviderCheckAt: Date | null;
};

export function isProviderCheckDue(
  lastProviderCheckAt: Date | null | undefined,
  cutoff: Date,
): boolean {
  return !lastProviderCheckAt || lastProviderCheckAt <= cutoff;
}

function providerCheckDueWhere(cutoff: Date) {
  return {
    OR: [
      { lastProviderCheckAt: null },
      { lastProviderCheckAt: { lte: cutoff } },
    ],
  };
}

function safeReconciliationError(error: unknown, context: 'subaccount' = 'subaccount'): string {
  const classified = classifyAsaasOperationalError(error, context);
  const status = classified.status ? `:${classified.status}` : '';
  const detailCode = classified.details[0]?.code ? `:${classified.details[0].code}` : '';
  return `${classified.category}${status}${detailCode}`;
}

type ReconciliationBudget = {
  used: number;
  max: number;
  startedAtMs: number;
  maxDurationMs: number;
  exhausted: boolean;
};

function reserveAsaasCall(budget: ReconciliationBudget, errors: string[]): boolean {
  if (budget.exhausted) return false;
  if (budget.used >= budget.max || Date.now() - budget.startedAtMs >= budget.maxDurationMs) {
    budget.exhausted = true;
    const reason = budget.used >= budget.max ? 'ASAAS_CALL_BUDGET_EXCEEDED' : 'RECONCILIATION_DEADLINE_EXCEEDED';
    if (!errors.includes(reason)) errors.push(reason);
    return false;
  }
  budget.used += 1;
  return true;
}

async function hasInflightWebhookForPayment(contaId: string, asaasPaymentId: string): Promise<boolean> {
  const inflight = await prisma.webhookAsaas.findFirst({
    where: {
      contaId,
      asaasPaymentId,
      status: { in: [...RECONCILE_INFLIGHT_WEBHOOK_STATUSES] },
    },
    select: { id: true },
  });
  return Boolean(inflight);
}

/**
 * Lista pagamentos locais em status não-final com integração Asaas.
 * Dedupe por asaasPaymentId (Charge avulsa + Cobranca acadêmica).
 */
async function listPaymentReconciliationCandidates(
  contaId: string,
  limit: number,
  cutoff: Date,
): Promise<PaymentReconciliationCandidate[]> {
  const [standaloneCharges, academicCobrancas] = await Promise.all([
    prisma.charge.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: { in: NON_FINAL_CHARGE_STATUSES },
        ...providerCheckDueWhere(cutoff),
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        asaasStatus: true,
        lastProviderCheckAt: true,
        externalReference: true,
      },
    }),
    prisma.cobranca.findMany({
      where: {
        contaId,
        matricula: { aluno: { contaId } },
        asaasPaymentId: { not: null },
        status: { in: NON_FINAL_STATUSES as Prisma.EnumStatusCobrancaFilter['in'] },
        ...providerCheckDueWhere(cutoff),
      },
      orderBy: { vencimento: 'asc' },
      take: limit,
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        asaasStatus: true,
        lastProviderCheckAt: true,
        charge: { select: { externalReference: true } },
      },
    }),
  ]);

  const byPaymentId = new Map<string, PaymentReconciliationCandidate>();

  for (const charge of standaloneCharges) {
    if (!charge.asaasPaymentId) continue;
    byPaymentId.set(charge.asaasPaymentId, {
      entityId: charge.id,
      asaasPaymentId: charge.asaasPaymentId,
      localStatus: charge.status,
      persistedAsaasStatus: charge.asaasStatus,
      externalReference: charge.externalReference,
      source: 'charge',
      lastProviderCheckAt: charge.lastProviderCheckAt,
    });
  }

  for (const cobranca of academicCobrancas) {
    if (!cobranca.asaasPaymentId || byPaymentId.has(cobranca.asaasPaymentId)) continue;
    byPaymentId.set(cobranca.asaasPaymentId, {
      entityId: cobranca.id,
      asaasPaymentId: cobranca.asaasPaymentId,
      localStatus: cobranca.status,
      persistedAsaasStatus: cobranca.asaasStatus,
      externalReference: cobranca.charge?.externalReference ?? null,
      source: 'cobranca',
      lastProviderCheckAt: cobranca.lastProviderCheckAt,
    });
  }

  return Array.from(byPaymentId.values()).slice(0, limit);
}

function resolvePaymentDriftIssueType(
  candidate: PaymentReconciliationCandidate,
  remoteAsaasStatus: string,
): 'ASAAS_SNAPSHOT_STALE' | 'PAYMENT_STATUS_DRIFT' {
  const normalizedRemote = remoteAsaasStatus.trim().toUpperCase();
  const normalizedPersisted = (candidate.persistedAsaasStatus ?? '').trim().toUpperCase();
  if (normalizedPersisted && normalizedPersisted !== normalizedRemote) {
    return 'ASAAS_SNAPSHOT_STALE';
  }
  return 'PAYMENT_STATUS_DRIFT';
}

function hasPaymentReconciliationDrift(
  remoteAsaasStatus: string,
  candidate: PaymentReconciliationCandidate,
): boolean {
  const normalizedRemote = remoteAsaasStatus.trim().toUpperCase();
  const normalizedPersisted = (candidate.persistedAsaasStatus ?? '').trim().toUpperCase();

  if (!normalizedPersisted || normalizedPersisted !== normalizedRemote) {
    return true;
  }

  const remoteChargeStatus = mapAsaasToChargeStatus(remoteAsaasStatus);

  if (candidate.source === 'charge') {
    return remoteChargeStatus !== candidate.localStatus;
  }

  if (remoteChargeStatus === 'PAID') {
    return candidate.localStatus !== 'PAGO';
  }
  if (remoteChargeStatus === 'CANCELED') {
    return candidate.localStatus !== 'CANCELADO';
  }
  if (remoteChargeStatus === 'REFUNDED') {
    return candidate.localStatus !== 'ESTORNADO' && candidate.localStatus !== 'ESTORNADO_PARCIAL';
  }
  if (remoteChargeStatus === 'OVERDUE') {
    return candidate.localStatus !== 'ATRASADO';
  }
  if (remoteChargeStatus === 'OPEN') {
    return !['PENDENTE', 'A_VENCER', 'PROCESSANDO'].includes(candidate.localStatus);
  }

  return false;
}

async function attachLastWebhookAt<T extends { asaasPaymentId: string | null }>(
  contaId: string,
  rows: T[],
): Promise<Array<T & { lastWebhookAt: Date | null }>> {
  const paymentIds = rows.flatMap((row) => row.asaasPaymentId ? [row.asaasPaymentId] : []);
  const webhooks = paymentIds.length === 0
    ? []
    : (await prisma.webhookAsaas.findMany({
        where: { contaId, asaasPaymentId: { in: paymentIds } },
        orderBy: { recebidoEm: 'desc' },
        select: { asaasPaymentId: true, recebidoEm: true },
      }) ?? []);
  const latestByPaymentId = new Map<string, Date>();
  for (const webhook of webhooks) {
    if (webhook.asaasPaymentId && !latestByPaymentId.has(webhook.asaasPaymentId)) {
      latestByPaymentId.set(webhook.asaasPaymentId, webhook.recebidoEm);
    }
  }
  return rows.map((row) => ({
    ...row,
    lastWebhookAt: row.asaasPaymentId ? latestByPaymentId.get(row.asaasPaymentId) ?? null : null,
  }));
}

async function attachLastWebhookAtToSubscriptions<T extends { asaasSubscriptionId: string | null }>(
  contaId: string,
  rows: T[],
): Promise<Array<T & { lastWebhookAt: Date | null }>> {
  const subscriptionIds = rows.flatMap((row) => row.asaasSubscriptionId ? [row.asaasSubscriptionId] : []);
  const webhooks = subscriptionIds.length === 0
    ? []
    : (await prisma.webhookAsaas.findMany({
        where: { contaId, asaasSubscriptionId: { in: subscriptionIds } },
        orderBy: { recebidoEm: 'desc' },
        select: { asaasSubscriptionId: true, recebidoEm: true },
      }) ?? []);
  const latestBySubscriptionId = new Map<string, Date>();
  for (const webhook of webhooks) {
    if (webhook.asaasSubscriptionId && !latestBySubscriptionId.has(webhook.asaasSubscriptionId)) {
      latestBySubscriptionId.set(webhook.asaasSubscriptionId, webhook.recebidoEm);
    }
  }
  return rows.map((row) => ({
    ...row,
    lastWebhookAt: row.asaasSubscriptionId
      ? latestBySubscriptionId.get(row.asaasSubscriptionId) ?? null
      : null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta cobranças que podem estar com eventos faltando.
 * Critérios:
 * - Cobrança acadêmica ou avulsa em status não-final
 * - Vencimento dentro da janela (ou já vencido), quando aplicável
 * - Sem webhook recente (últimas 24h)
 */
export async function detectWebhookGaps(
  contaId: string,
  options: ReconciliationOptions = {}
): Promise<WebhookGapDetectionResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const chargeLimit = options.chargeLimit ?? DEFAULT_CHARGE_LIMIT;
  
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const [academicCobrancas, standaloneCharges] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        contaId,
        matricula: {
          aluno: { contaId },
        },
        status: { in: NON_FINAL_STATUSES as Prisma.EnumStatusCobrancaFilter['in'] },
        asaasPaymentId: { not: null },
        vencimento: {
          gte: windowStart,
          lte: now,
        },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        vencimento: true,
      },
      orderBy: { vencimento: 'asc' },
      take: chargeLimit,
    }),
    prisma.charge.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: { in: NON_FINAL_CHARGE_STATUSES },
        OR: [{ dueDate: null }, { dueDate: { gte: windowStart, lte: now } }],
      },
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        dueDate: true,
      },
      orderBy: { dueDate: 'asc' },
      take: chargeLimit,
    }),
  ]);

  const chargesWithMissingFinalStatus = [
    ...academicCobrancas.map((cobranca) => ({
      id: cobranca.id,
      asaasPaymentId: cobranca.asaasPaymentId,
      status: cobranca.status,
      dueDate: cobranca.vencimento,
    })),
    ...standaloneCharges.map((charge) => ({
      id: charge.id,
      asaasPaymentId: charge.asaasPaymentId,
      status: charge.status,
      dueDate: charge.dueDate,
    })),
  ].slice(0, chargeLimit);

  const chargesWithWebhookInfo = await attachLastWebhookAt(contaId, chargesWithMissingFinalStatus);

  // O gap é uma ausência de evento além da tolerância operacional configurada.
  const oneDayAgo = new Date(now);
  oneDayAgo.setTime(oneDayAgo.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const chargesWithGap = chargesWithWebhookInfo.filter(
    (c) => !c.lastWebhookAt || c.lastWebhookAt < oneDayAgo
  );

  // Assinaturas ativas sem eventos recentes
  const subscriptionsWithMissingEvents = await prisma.subscription.findMany({
    where: {
      contaId,
      status: 'ACTIVE',
      asaasSubscriptionId: { not: null },
    },
    select: {
      id: true,
      asaasSubscriptionId: true,
      status: true,
    },
    take: chargeLimit,
  });

  const subscriptionsWithWebhookInfo = await attachLastWebhookAtToSubscriptions(
    contaId,
    subscriptionsWithMissingEvents,
  );

  const subscriptionsWithGap = subscriptionsWithWebhookInfo.filter(
    (s) => !s.lastWebhookAt || s.lastWebhookAt < oneDayAgo
  );

  if (options.persistIssues) {
    await Promise.all([
      ...chargesWithGap.map((charge) =>
        upsertFinanceReconciliationIssue({
          contaId,
          entityType: 'CHARGE',
          entityId: charge.id,
          asaasId: charge.asaasPaymentId,
          issueType: 'WEBHOOK_LAG',
          severity: 'HIGH',
          localStatus: charge.status,
          remoteStatus: null,
          metadata: {
            dueDate: charge.dueDate?.toISOString() ?? null,
            lastWebhookAt: charge.lastWebhookAt?.toISOString() ?? null,
            source: 'detectWebhookGaps',
          },
        }),
      ),
      ...subscriptionsWithGap.map((subscription) =>
        upsertFinanceReconciliationIssue({
          contaId,
          entityType: 'SUBSCRIPTION',
          entityId: subscription.id,
          asaasId: subscription.asaasSubscriptionId,
          issueType: 'WEBHOOK_LAG',
          severity: 'MEDIUM',
          localStatus: subscription.status,
          remoteStatus: null,
          metadata: {
            lastWebhookAt: subscription.lastWebhookAt?.toISOString() ?? null,
            source: 'detectWebhookGaps',
          },
        }),
      ),
    ]);
  }

  return {
    chargesWithMissingFinalStatus: chargesWithGap,
    subscriptionsWithMissingEvents: subscriptionsWithGap,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK METRICS
// ═══════════════════════════════════════════════════════════════════════════

export interface WebhookMetricsSummary {
  contaId: string;
  windowDays: number;
  total: number;
  byStatus: Record<string, number>;
  byEvent: Record<string, number>;
  avgDurationMs: number | null;
  errorRate: number;
  lastProcessedAt: Date | null;
}

/**
 * Calcula métricas de webhooks para uma conta em uma janela de tempo.
 */
export async function getWebhookMetrics(
  contaId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<WebhookMetricsSummary> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  const webhooks = await prisma.webhookAsaas.findMany({
    where: {
      contaId,
      recebidoEm: { gte: windowStart },
    },
    select: {
      status: true,
      evento: true,
      duracaoMs: true,
      processadoEm: true,
    },
  });

  const byStatus: Record<string, number> = {};
  const byEvent: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  let errorCount = 0;
  let lastProcessedAt: Date | null = null;

  for (const webhook of webhooks) {
    byStatus[webhook.status] = (byStatus[webhook.status] ?? 0) + 1;
    byEvent[webhook.evento] = (byEvent[webhook.evento] ?? 0) + 1;

    if (webhook.duracaoMs) {
      totalDuration += webhook.duracaoMs;
      durationCount += 1;
    }

    if (webhook.status === 'ERRO') {
      errorCount += 1;
    }

    if (webhook.processadoEm && (!lastProcessedAt || webhook.processadoEm > lastProcessedAt)) {
      lastProcessedAt = webhook.processadoEm;
    }
  }

  return {
    contaId,
    windowDays,
    total: webhooks.length,
    byStatus,
    byEvent,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
    errorRate: webhooks.length > 0 ? errorCount / webhooks.length : 0,
    lastProcessedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK LISTING (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export interface WebhookListItem {
  id: string;
  evento: string;
  eventId: string | null;
  status: string;
  recebidoEm: Date;
  processadoEm: Date | null;
  duracaoMs: number | null;
  tentativas: number;
  ultimoErro: string | null;
  asaasPaymentId: string | null;
  asaasSubscriptionId: string | null;
}

export interface WebhookListOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  evento?: string;
  asaasPaymentId?: string;
  asaasSubscriptionId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface WebhookListResult {
  items: WebhookListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lista webhooks com filtros para painel admin.
 */
export async function listWebhooks(
  contaId: string,
  options: WebhookListOptions = {}
): Promise<WebhookListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.WebhookAsaasWhereInput = {
    contaId,
    ...(options.status && { status: options.status }),
    ...(options.evento && { evento: { contains: options.evento } }),
    ...(options.asaasPaymentId && { asaasPaymentId: options.asaasPaymentId }),
    ...(options.asaasSubscriptionId && { asaasSubscriptionId: options.asaasSubscriptionId }),
    ...(options.startDate && { recebidoEm: { gte: options.startDate } }),
    ...(options.endDate && { recebidoEm: { lte: options.endDate } }),
  };

  const [items, total] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where,
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        processadoEm: true,
        duracaoMs: true,
        tentativas: true,
        ultimoErro: true,
        asaasPaymentId: true,
        asaasSubscriptionId: true,
      },
      orderBy: { recebidoEm: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.webhookAsaas.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Busca detalhes de um webhook específico incluindo payload e tentativas.
 */
export async function getWebhookDetails(
  contaId: string,
  webhookId: string
): Promise<{
  webhook: Prisma.WebhookAsaasGetPayload<object> | null;
  relatedCharge: { id: string; status: string } | null;
  relatedSubscription: { id: string; status: string } | null;
}> {
  const webhook = await prisma.webhookAsaas.findFirst({
    where: { id: webhookId, contaId },
  });

  if (!webhook) {
    return { webhook: null, relatedCharge: null, relatedSubscription: null };
  }

  const relatedCharge = webhook.asaasPaymentId
    ? await prisma.cobranca.findFirst({
        where: {
          contaId,
          asaasPaymentId: webhook.asaasPaymentId,
          matricula: { aluno: { contaId } },
        },
        select: { id: true, status: true },
      })
    : null;

  const relatedSubscription = webhook.asaasSubscriptionId
    ? await prisma.subscription.findFirst({
        where: { contaId, asaasSubscriptionId: webhook.asaasSubscriptionId },
        select: { id: true, status: true },
      })
    : null;

  return { webhook, relatedCharge, relatedSubscription };
}

/**
 * Métricas operacionais da fila de webhook.
 * Útil para SLO de backlog/lag/retries.
 */
export async function getWebhookQueueMetrics(
  options: QueueMetricsOptions = {}
): Promise<QueueMetricsResult> {
  const now = new Date();
  const processingTimeoutMinutes = Math.max(1, options.processingTimeoutMinutes ?? DEFAULT_PROCESSING_TIMEOUT_MINUTES);
  const stuckThreshold = new Date(now.getTime() - processingTimeoutMinutes * 60_000);

  const whereBase: Prisma.WebhookAsaasWhereInput = options.contaId
    ? { contaId: options.contaId }
    : {};

  const [pending, processing, errored, processed, highRetryBacklog, stuckProcessing, oldestPending] = await Promise.all([
    prisma.webhookAsaas.count({ where: { ...whereBase, status: 'PENDENTE' } }),
    prisma.webhookAsaas.count({ where: { ...whereBase, status: 'PROCESSANDO' } }),
    prisma.webhookAsaas.count({ where: { ...whereBase, status: 'ERRO' } }),
    prisma.webhookAsaas.count({ where: { ...whereBase, status: 'PROCESSADO' } }),
    prisma.webhookAsaas.count({
      where: {
        ...whereBase,
        status: { in: ['PENDENTE', 'ERRO', 'PROCESSANDO'] },
        tentativas: { gte: 3 },
      },
    }),
    prisma.webhookAsaas.count({
      where: {
        ...whereBase,
        status: 'PROCESSANDO',
        OR: [
          { ultimaTentativaEm: { lt: stuckThreshold } },
          { ultimaTentativaEm: null },
        ],
      },
    }),
    prisma.webhookAsaas.findFirst({
      where: {
        ...whereBase,
        status: { in: ['PENDENTE', 'ERRO'] },
      },
      orderBy: { recebidoEm: 'asc' },
      select: { recebidoEm: true },
    }),
  ]);

  const backlog = pending + processing + errored;
  const oldestPendingAt = oldestPending?.recebidoEm ?? null;
  const lagSeconds = oldestPendingAt ? Math.max(0, Math.floor((now.getTime() - oldestPendingAt.getTime()) / 1000)) : null;

  return {
    contaId: options.contaId ?? 'ALL',
    backlog,
    pending,
    processing,
    errored,
    processed,
    highRetryBacklog,
    stuckProcessing,
    oldestPendingAt,
    lagSeconds,
    generatedAt: now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STUCK PROCESSING RECOVERY
// ═══════════════════════════════════════════════════════════════════════════

export interface RecoverStuckOptions {
  contaId?: string;
  timeoutMinutes?: number;
  limit?: number;
}

export interface RecoverStuckResult {
  recovered: number;
  ids: string[];
  generatedAt: Date;
}

/**
 * Recupera webhooks travados em PROCESSANDO por mais de `timeoutMinutes`.
 * Reseta para ERRO para que o worker reprocesse normalmente.
 */
export async function recoverStuckWebhooks(
  options: RecoverStuckOptions = {},
): Promise<RecoverStuckResult> {
  const timeoutMinutes = Math.max(1, options.timeoutMinutes ?? DEFAULT_PROCESSING_TIMEOUT_MINUTES);
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const threshold = new Date(Date.now() - timeoutMinutes * 60_000);

  const where: Prisma.WebhookAsaasWhereInput = {
    status: 'PROCESSANDO',
    OR: [
      { ultimaTentativaEm: { lt: threshold } },
      { ultimaTentativaEm: null, recebidoEm: { lt: threshold } },
    ],
    ...(options.contaId ? { contaId: options.contaId } : {}),
  };

  const stuck = await prisma.webhookAsaas.findMany({
    where,
    select: { id: true },
    orderBy: { recebidoEm: 'asc' },
    take: limit,
  });

  if (!stuck.length) {
    return { recovered: 0, ids: [], generatedAt: new Date() };
  }

  const ids = stuck.map((s) => s.id);

  const result = await prisma.webhookAsaas.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'ERRO',
      ultimoErro: `Recovered from stuck PROCESSANDO (timeout: ${timeoutMinutes}min)`,
    },
  });

  return {
    recovered: result.count,
    ids,
    generatedAt: new Date(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RETENTION ALERTS
// ═══════════════════════════════════════════════════════════════════════════

// Asaas retém webhooks por 14 dias. Thresholds para alertar antes de perda.
const RETENTION_THRESHOLDS = [
  { label: 'CRITICAL', lagSeconds: 12 * 24 * 3600 },  // 12d
  { label: 'HIGH',     lagSeconds: 7 * 24 * 3600 },   // 7d
  { label: 'WARNING',  lagSeconds: 24 * 3600 },        // 24h
  { label: 'INFO',     lagSeconds: 3600 },              // 1h
] as const;

export type RetentionAlertLevel = typeof RETENTION_THRESHOLDS[number]['label'];

export interface RetentionAlert {
  level: RetentionAlertLevel;
  lagSeconds: number;
  oldestPendingAt: Date;
  backlog: number;
  contaId: string | 'ALL';
  message: string;
}

/**
 * Avalia métricas da fila e retorna alerta de retenção se lag excede thresholds.
 * Retorna null se a fila está saudável (lag < 1h ou sem backlog).
 *
 * Thresholds (Asaas retém por 14d):
 * - INFO: lag >= 1h
 * - WARNING: lag >= 24h
 * - HIGH: lag >= 7d
 * - CRITICAL: lag >= 12d (risco de perda de eventos)
 */
export function evaluateRetentionAlert(metrics: QueueMetricsResult): RetentionAlert | null {
  if (!metrics.lagSeconds || metrics.lagSeconds < RETENTION_THRESHOLDS[RETENTION_THRESHOLDS.length - 1].lagSeconds) {
    return null;
  }

  const matched = RETENTION_THRESHOLDS.find((t) => metrics.lagSeconds! >= t.lagSeconds);
  if (!matched) return null;

  const lagDays = Math.floor(metrics.lagSeconds / 86400);
  const lagHours = Math.floor((metrics.lagSeconds % 86400) / 3600);

  return {
    level: matched.label,
    lagSeconds: metrics.lagSeconds,
    oldestPendingAt: metrics.oldestPendingAt!,
    backlog: metrics.backlog,
    contaId: metrics.contaId,
    message: `Webhook queue lag ${lagDays}d ${lagHours}h (${metrics.backlog} pending). Asaas retention is 14d.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXHAUSTED / DLQ MARKING
// ═══════════════════════════════════════════════════════════════════════════

export interface MarkExhaustedOptions {
  contaId?: string;
  ids?: string[];
  maxAttempts?: number;
  limit?: number;
}

export interface MarkExhaustedResult {
  marked: number;
  ids: string[];
  generatedAt: Date;
}

const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Marca webhooks em ERRO que excederam o limite de tentativas como EXAURIDO (DLQ).
 * Esses registros não serão mais reprocessados automaticamente, mas ficam disponíveis
 * para replay manual e auditoria.
 */
export async function markExhaustedWebhooks(
  options: MarkExhaustedOptions = {},
): Promise<MarkExhaustedResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const scopedIds = options.ids?.filter((id) => typeof id === 'string' && id.length > 0) ?? [];
  const defaultLimit = scopedIds.length > 0 ? scopedIds.length : 200;
  const limit = Math.min(500, Math.max(1, options.limit ?? defaultLimit));

  const where: Prisma.WebhookAsaasWhereInput = {
    status: 'ERRO',
    tentativas: { gte: maxAttempts },
    ...(options.contaId ? { contaId: options.contaId } : {}),
    ...(scopedIds.length > 0 ? { id: { in: scopedIds } } : {}),
  };

  const candidates = await prisma.webhookAsaas.findMany({
    where,
    select: { id: true, contaId: true },
    orderBy: { recebidoEm: 'asc' },
    take: limit,
  });

  if (!candidates.length) {
    return { marked: 0, ids: [], generatedAt: new Date() };
  }

  const ids = candidates.map((c) => c.id);

  const result = await prisma.webhookAsaas.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'EXAURIDO',
      ultimoErro: `Exhausted after ${maxAttempts} attempts. Marked as DLQ.`,
      nextRetryAt: null,
    },
  });

  if (result.count > 0) {
    console.warn('[webhook-dlq] Webhooks marcados como EXAURIDO', {
      count: result.count,
      ids,
    });

    // Alerta estruturado para observabilidade (DLQ)
    console.error(JSON.stringify({
      level: 'error',
      type: 'webhook_dlq_exhausted',
      count: result.count,
      ids,
      maxAttempts,
      message: `${result.count} webhook(s) moved to DLQ after ${maxAttempts} failed attempts`,
      timestamp: new Date().toISOString(),
    }));

    const idsByConta = candidates.reduce<Record<string, string[]>>((acc, candidate) => {
      acc[candidate.contaId] ??= [];
      acc[candidate.contaId].push(candidate.id);
      return acc;
    }, {});

    await Promise.all(
      Object.entries(idsByConta).map(([contaId, contaIds]) =>
        alertService.alertDLQ(contaId, contaIds.length, contaIds).catch((err: unknown) => {
          console.warn('[webhook-dlq][alert-failed]', { contaId, err });
        }),
      ),
    );
  }

  return {
    marked: result.count,
    ids,
    generatedAt: new Date(),
  };
}

/**
 * Move webhooks antigos já processados para tabela de arquivo frio.
 */
export async function archiveProcessedWebhooks(
  options: ArchiveWebhooksOptions = {}
): Promise<ArchiveWebhooksResult> {
  const olderThanDays = Math.max(1, options.olderThanDays ?? DEFAULT_ARCHIVE_DAYS);
  const limit = Math.min(5000, Math.max(1, options.limit ?? DEFAULT_ARCHIVE_LIMIT));
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  const where: Prisma.WebhookAsaasWhereInput = {
    status: 'PROCESSADO',
    recebidoEm: { lt: cutoff },
    ...(options.contaId ? { contaId: options.contaId } : {}),
  };

  const rows = await prisma.webhookAsaas.findMany({
    where,
    orderBy: { recebidoEm: 'asc' },
    take: limit,
    select: {
      id: true,
      contaId: true,
      evento: true,
      eventId: true,
      payloadHash: true,
      payload: true,
      recebidoEm: true,
      processadoEm: true,
      status: true,
      asaasPaymentId: true,
      asaasSubscriptionId: true,
      asaasTransferId: true,
      tentativas: true,
      ultimaTentativaEm: true,
      duracaoMs: true,
      ultimoErro: true,
      attemptsLog: true,
    },
  });

  if (!rows.length) {
    return {
      contaId: options.contaId ?? 'ALL',
      olderThanDays,
      selected: 0,
      archived: 0,
      deletedFromHot: 0,
      generatedAt: now,
    };
  }

  const ids = rows.map((row) => row.id);

  const result = await prisma.$transaction(async (tx) => {
    const createResult = await tx.webhookAsaasArchive.createMany({
      data: rows.map((row) => ({
        id: row.id,
        contaId: row.contaId,
        evento: row.evento,
        eventId: row.eventId,
        payloadHash: row.payloadHash,
        payload: row.payload as Prisma.InputJsonValue,
        recebidoEm: row.recebidoEm,
        processadoEm: row.processadoEm,
        status: row.status,
        asaasPaymentId: row.asaasPaymentId,
        asaasSubscriptionId: row.asaasSubscriptionId,
        asaasTransferId: row.asaasTransferId,
        tentativas: row.tentativas,
        ultimaTentativaEm: row.ultimaTentativaEm,
        duracaoMs: row.duracaoMs,
        ultimoErro: row.ultimoErro,
        attemptsLog: row.attemptsLog as Prisma.InputJsonValue,
        archivedAt: now,
      })),
      skipDuplicates: true,
    });

    const deleteResult = await tx.webhookAsaas.deleteMany({
      where: { id: { in: ids } },
    });

    return { archived: createResult.count, deleted: deleteResult.count };
  });

  return {
    contaId: options.contaId ?? 'ALL',
    olderThanDays,
    selected: rows.length,
    archived: result.archived,
    deletedFromHot: result.deleted,
    generatedAt: now,
  };
}

function chooseSyntheticSubscriptionEvent(remote: {
  status?: string;
  deleted?: boolean;
}): string {
  if (remote.deleted) return 'SUBSCRIPTION_DELETED';
  if (remote.status === 'INACTIVE') return 'SUBSCRIPTION_INACTIVATED';
  return 'SUBSCRIPTION_UPDATED';
}

/**
 * Reconciliação ativa com Asaas:
 * - Pagamentos: cobranças locais em status não-final → 1× getPayment por candidato;
 *   aplica webhook sintético (PAYMENT_RECEIVED/CONFIRMED/…) quando há drift.
 * - Assinaturas/parcelamentos: janela por updatedAt (windowHours).
 * - Ignora pagamentos com webhook ainda na fila (PENDENTE/PROCESSANDO).
 */
export async function reconcileWithAsaas(
  options: AsaasReconcileOptions
): Promise<AsaasReconcileResult> {
  const startedAt = new Date();
  const now = startedAt;
  const mode = options.mode ?? 'targeted';
  const providerCheckIntervalMinutes = Math.max(
    5,
    Math.min(
      7 * 24 * 60,
      options.providerCheckIntervalMinutes
        ?? (mode === 'safety_sweep'
          ? DEFAULT_SAFETY_SWEEP_INTERVAL_MINUTES
          : DEFAULT_PROVIDER_CHECK_INTERVAL_MINUTES),
    ),
  );
  const providerCheckCutoff = new Date(now.getTime() - providerCheckIntervalMinutes * 60_000);
  const limit = Math.min(1000, Math.max(1, options.limit ?? DEFAULT_RECONCILE_LIMIT));
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];
  const budget: ReconciliationBudget = {
    used: 0,
    max: Math.min(1000, Math.max(1, options.maxAsaasCalls ?? DEFAULT_MAX_ASAAS_CALLS)),
    startedAtMs: startedAt.getTime(),
    maxDurationMs: Math.min(110_000, Math.max(5_000, options.maxDurationMs ?? DEFAULT_MAX_RECONCILE_DURATION_MS)),
    exhausted: false,
  };

  const buildResult = (overrides: Partial<AsaasReconcileResult> = {}): AsaasReconcileResult => {
    const completedAt = new Date();
    return {
      contaId: options.contaId,
      dryRun,
      mode,
      correlationId: options.correlationId ?? null,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      asaasCalls: budget.used,
      maxAsaasCalls: budget.max,
      budgetExhausted: budget.exhausted,
      providerCheckIntervalMinutes,
      checkedPayments: 0,
      reconciledPayments: 0,
      paymentDrift: 0,
      checkedSubscriptions: 0,
      reconciledSubscriptions: 0,
      subscriptionDrift: 0,
      checkedInstallments: 0,
      installmentDrift: 0,
      errors,
      generatedAt: completedAt,
      ...overrides,
    };
  };

  const credentials = await loadAsaasCredentials(options.contaId);
  if (!credentials?.apiKey) {
    errors.push('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    return buildResult();
  }

  const paymentCandidates = await listPaymentReconciliationCandidates(
    options.contaId,
    limit,
    providerCheckCutoff,
  );

  let checkedPayments = 0;
  let reconciledPayments = 0;
  let paymentDrift = 0;
  let checkedSubscriptions = 0;
  let reconciledSubscriptions = 0;
  let subscriptionDrift = 0;
  let checkedInstallments = 0;
  let installmentDrift = 0;
  const remoteSubscriptions = new Map<string, AsaasSubscription>();

  const [subscriptions, canonicalAgreements, installmentPlans, standaloneInstallments] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        contaId: options.contaId,
        asaasSubscriptionId: { not: null },
        OR: [{ lastProviderCheckAt: null }, { lastProviderCheckAt: { lte: providerCheckCutoff } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        asaasSubscriptionId: true,
        status: true,
        lastProviderCheckAt: true,
      },
    }),
    prisma.billingAgreement.findMany({
      where: {
        contaId: options.contaId,
        asaasSubscriptionId: { not: null },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
        OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: providerCheckCutoff } }],
      },
      orderBy: [{ lastReconciledAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        asaasSubscriptionId: true,
        status: true,
        remoteStatus: true,
        desiredValue: true,
        confirmedValue: true,
        lastReconciledAt: true,
      },
    }),
    prisma.installmentPlan.findMany({
      where: {
        contaId: options.contaId,
        asaasInstallmentId: { not: null },
        OR: [{ lastProviderCheckAt: null }, { lastProviderCheckAt: { lte: providerCheckCutoff } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, asaasInstallmentId: true, lastProviderCheckAt: true },
    }),
    prisma.standaloneInstallmentPlan.findMany({
      where: {
        contaId: options.contaId,
        asaasInstallmentId: { not: null },
        OR: [{ lastProviderCheckAt: null }, { lastProviderCheckAt: { lte: providerCheckCutoff } }],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, asaasInstallmentId: true, lastProviderCheckAt: true },
    }),
  ]);

  for (const candidate of paymentCandidates) {
    if (budget.exhausted) break;
    checkedPayments += 1;
    try {
      if (await hasInflightWebhookForPayment(options.contaId, candidate.asaasPaymentId)) {
        continue;
      }

      if (!reserveAsaasCall(budget, errors)) break;
      recordAsaasReadIntent('RECONCILIATION');
      const remote = await getPayment({
        apiKey: credentials.apiKey,
        paymentId: candidate.asaasPaymentId,
      });
      const remoteStatus = resolveRemotePaymentSnapshotStatus(remote);
      const remoteLocalStatus = mapAsaasToChargeStatus(remoteStatus);
      if (!hasPaymentReconciliationDrift(remoteStatus, candidate)) {
        if (!dryRun) {
          const providerCheckAt = new Date();
          if (candidate.source === 'charge') {
            await prisma.charge.updateMany({
              where: { id: candidate.entityId, contaId: options.contaId },
              data: { lastProviderCheckAt: providerCheckAt, lastAsaasFetchAt: providerCheckAt },
            });
          } else {
            await prisma.cobranca.updateMany({
              where: { id: candidate.entityId, contaId: options.contaId },
              data: { lastProviderCheckAt: providerCheckAt, lastAsaasFetchAt: providerCheckAt },
            });
          }
        }
        continue;
      }

      paymentDrift += 1;
      if (!dryRun) {
        await upsertFinanceReconciliationIssue({
          contaId: options.contaId,
          entityType: 'CHARGE',
          entityId: candidate.entityId,
          asaasId: candidate.asaasPaymentId,
          issueType: resolvePaymentDriftIssueType(candidate, remoteStatus),
          severity: 'HIGH',
          localStatus: candidate.localStatus,
          remoteStatus: remoteLocalStatus,
          metadata: {
            asaasStatus: remoteStatus,
            persistedAsaasStatus: candidate.persistedAsaasStatus,
            externalReference: candidate.externalReference ?? remote.externalReference ?? null,
            source: 'reconcileWithAsaas',
            candidateSource: candidate.source,
          },
        });
        const event = PAYMENT_EVENT_BY_STATUS[remoteStatus] ?? 'PAYMENT_UPDATED';
        const handlerResult = await handlePaymentWebhook(options.contaId, {
          event,
          eventId: `reconciliation:${remote.id}:${remoteStatus}`,
          source: 'RECONCILIATION',
          providerOccurredAt: remote.dateCreated ? new Date(remote.dateCreated) : null,
          payment: {
            id: remote.id,
            status: remoteStatus as never,
            value: Number(remote.value ?? 0),
            netValue: Number(remote.netValue ?? remote.value ?? 0),
            originalValue: typeof remote.originalValue === 'number' ? remote.originalValue : null,
            externalReference: remote.externalReference ?? candidate.externalReference ?? undefined,
            subscription: remote.subscription ?? null,
            installment: remote.installment ?? null,
            installmentNumber: null,
            dueDate: remote.dueDate ?? null,
            paymentDate: remote.paymentDate ?? null,
            clientPaymentDate: remote.clientPaymentDate ?? null,
            creditDate: remote.creditDate ?? null,
            estimatedCreditDate: remote.estimatedCreditDate ?? null,
            billingType: remote.billingType ?? null,
            deleted: remote.deleted ?? false,
          },
        });
        if (!handlerResult.success) {
          errors.push(`payment:${candidate.asaasPaymentId}:handler_failed`);
          continue;
        }
        const providerCheckAt = new Date();
        if (candidate.source === 'charge') {
          await prisma.charge.updateMany({
            where: { id: candidate.entityId, contaId: options.contaId },
            data: { lastProviderCheckAt: providerCheckAt, lastAsaasFetchAt: providerCheckAt },
          });
        } else {
          await prisma.cobranca.updateMany({
            where: { id: candidate.entityId, contaId: options.contaId },
            data: { lastProviderCheckAt: providerCheckAt, lastAsaasFetchAt: providerCheckAt },
          });
        }
        reconciledPayments += 1;
      }
    } catch (error) {
      errors.push(`payment:${candidate.asaasPaymentId}:${safeReconciliationError(error)}`);
    }
  }

  for (const sub of subscriptions) {
    if (budget.exhausted) break;
    if (!sub.asaasSubscriptionId) continue;
    checkedSubscriptions += 1;
    try {
      let remote = remoteSubscriptions.get(sub.asaasSubscriptionId);
      if (!remote) {
        if (!reserveAsaasCall(budget, errors)) break;
        recordAsaasReadIntent('RECONCILIATION');
        remote = await getSubscription({
          apiKey: credentials.apiKey,
          subscriptionId: sub.asaasSubscriptionId,
        });
        remoteSubscriptions.set(sub.asaasSubscriptionId, remote);
      }
      const nextStatus = mapAsaasSubscriptionStatus({
        status: remote.status,
        deleted: remote.deleted,
      });
      let providerStateApplied = nextStatus === sub.status;

      if (nextStatus !== sub.status) {
        subscriptionDrift += 1;
        if (!dryRun) {
          await upsertFinanceReconciliationIssue({
            contaId: options.contaId,
            entityType: 'SUBSCRIPTION',
            entityId: sub.id,
            asaasId: sub.asaasSubscriptionId,
            issueType: 'SUBSCRIPTION_STATUS_DRIFT',
            severity: 'HIGH',
            localStatus: sub.status,
            remoteStatus: nextStatus,
            metadata: {
              asaasStatus: remote.status,
              deleted: remote.deleted ?? null,
              source: 'reconcileWithAsaas',
            },
          });
          const event = chooseSyntheticSubscriptionEvent({
            status: remote.status,
            deleted: remote.deleted,
          });
          const result = await handleSubscriptionWebhook(options.contaId, {
            event,
            subscription: {
              id: remote.id,
              status: remote.status,
              externalReference: remote.externalReference ?? undefined,
              deleted: remote.deleted,
            },
          });
          if (result.success) {
            reconciledSubscriptions += 1;
            providerStateApplied = true;
          } else {
            errors.push(`subscription:${sub.asaasSubscriptionId}:handler_failed`);
          }
        }
      }
      if (!dryRun && providerStateApplied) {
        await prisma.subscription.updateMany({
          where: { id: sub.id, contaId: options.contaId },
          data: { lastProviderCheckAt: new Date() },
        });
      }
    } catch (error) {
      errors.push(`subscription:${sub.asaasSubscriptionId}:${safeReconciliationError(error)}`);
    }
  }

  for (const agreement of canonicalAgreements) {
    if (budget.exhausted) break;
    if (!agreement.asaasSubscriptionId) continue;
    checkedSubscriptions += 1;
    try {
      let remote = remoteSubscriptions.get(agreement.asaasSubscriptionId);
      if (!remote) {
        if (!reserveAsaasCall(budget, errors)) break;
        recordAsaasReadIntent('RECONCILIATION');
        remote = await getSubscription({
          apiKey: credentials.apiKey,
          subscriptionId: agreement.asaasSubscriptionId,
        });
        remoteSubscriptions.set(agreement.asaasSubscriptionId, remote);
      }
      const remoteValue = Number(remote.value ?? 0);
      const remoteStatus = remote.deleted ? 'DELETED' : remote.status ?? 'UNKNOWN';
      const valueDrift = Number(agreement.confirmedValue) !== remoteValue;
      const statusDrift = (agreement.remoteStatus ?? '').toUpperCase() !== remoteStatus.toUpperCase();
      if (!valueDrift && !statusDrift) {
        if (!dryRun) {
          await prisma.billingAgreement.updateMany({
            where: { id: agreement.id, contaId: options.contaId },
            data: { lastReconciledAt: now, reconciliationError: null },
          });
        }
        continue;
      }

      subscriptionDrift += 1;
      if (!dryRun) {
        const desiredDiverges = Number(agreement.desiredValue) !== remoteValue;
        await upsertFinanceReconciliationIssue({
          contaId: options.contaId,
          entityType: 'SUBSCRIPTION',
          entityId: agreement.id,
          asaasId: agreement.asaasSubscriptionId,
          issueType: valueDrift ? 'BILLING_AGREEMENT_VALUE_DRIFT' : 'SUBSCRIPTION_STATUS_DRIFT',
          severity: desiredDiverges ? 'HIGH' : 'MEDIUM',
          localStatus: agreement.status,
          remoteStatus,
          metadata: {
            desiredValue: Number(agreement.desiredValue),
            previousConfirmedValue: Number(agreement.confirmedValue),
            remoteValue,
            source: 'canonicalBillingAgreement',
          },
        });
        await prisma.billingAgreement.updateMany({
          where: { id: agreement.id, contaId: options.contaId },
          data: {
            confirmedValue: remoteValue,
            remoteStatus,
            remoteStatusUpdatedAt: now,
            status: desiredDiverges ? 'REQUIRES_RECONCILIATION' : agreement.status,
          },
        });
        const event = chooseSyntheticSubscriptionEvent({ status: remote.status, deleted: remote.deleted });
        const handlerResult = await handleSubscriptionWebhook(options.contaId, {
          event,
          subscription: {
            id: remote.id,
            status: remote.status,
            externalReference: remote.externalReference ?? undefined,
            deleted: remote.deleted,
          },
        });
        const reconciliationError = handlerResult.success
          ? desiredDiverges
            ? `Valor desejado ${Number(agreement.desiredValue).toFixed(2)} diverge do Asaas ${remoteValue.toFixed(2)}.`
            : null
          : `Handler de assinatura falhou: ${handlerResult.error ?? 'unknown'}`;
        await prisma.billingAgreement.updateMany({
          where: { id: agreement.id, contaId: options.contaId },
          data: {
            reconciliationError,
            ...(handlerResult.success ? { lastReconciledAt: now } : {}),
          },
        });
        if (!handlerResult.success) {
          errors.push(`agreement:${agreement.id}:handler_failed`);
        }
        if (handlerResult.success) reconciledSubscriptions += 1;
      }
    } catch (error) {
      errors.push(`agreement:${agreement.id}:${safeReconciliationError(error)}`);
    }
  }

  const allInstallments = [
    ...installmentPlans.map((plan) => ({ id: plan.id, asaasInstallmentId: plan.asaasInstallmentId!, source: 'ACADEMIC' as const })),
    ...standaloneInstallments.map((plan) => ({ id: plan.id, asaasInstallmentId: plan.asaasInstallmentId!, source: 'STANDALONE' as const })),
  ];

  for (const plan of allInstallments) {
    if (budget.exhausted) break;
    checkedInstallments += 1;
    try {
      if (!reserveAsaasCall(budget, errors)) break;
      await getInstallment({ apiKey: credentials.apiKey, installmentId: plan.asaasInstallmentId });
      if (!reserveAsaasCall(budget, errors)) break;
      const remotePayments = await listInstallmentPayments({
        apiKey: credentials.apiKey,
        installmentId: plan.asaasInstallmentId,
        limit: 100,
        offset: 0,
      });

      const localCount = plan.source === 'ACADEMIC'
        ? await prisma.charge.count({
            where: {
              contaId: options.contaId,
              cobrancaId: { not: null },
              OR: [
                { externalReference: { startsWith: `installmentPlan:${plan.id}` } },
                { externalReference: { startsWith: `alusa:installment:${plan.id}` } },
              ],
            },
          })
        : await prisma.charge.count({
            where: {
              contaId: options.contaId,
              standaloneInstallmentPlanId: plan.id,
            },
          });

      if (localCount !== remotePayments.totalCount) {
        installmentDrift += 1;
        if (!dryRun) {
          await upsertFinanceReconciliationIssue({
            contaId: options.contaId,
            entityType: 'INSTALLMENT_PLAN',
            entityId: plan.id,
            asaasId: plan.asaasInstallmentId,
            issueType: 'PAYMENT_STATUS_DRIFT',
            severity: 'MEDIUM',
            localStatus: String(localCount),
            remoteStatus: String(remotePayments.totalCount),
            metadata: {
              source: 'reconcileWithAsaas',
              drift: 'INSTALLMENT_PAYMENT_COUNT',
              planSource: plan.source,
            },
          });
        }
      }
      if (!dryRun) {
        if (plan.source === 'ACADEMIC') {
          await prisma.installmentPlan.updateMany({
            where: { id: plan.id, contaId: options.contaId },
            data: { lastProviderCheckAt: new Date() },
          });
        } else {
          await prisma.standaloneInstallmentPlan.updateMany({
            where: { id: plan.id, contaId: options.contaId },
            data: { lastProviderCheckAt: new Date() },
          });
        }
      }
    } catch (error) {
      errors.push(`installment:${plan.asaasInstallmentId}:${safeReconciliationError(error)}`);
    }
  }

  if (!dryRun) {
    await reconcileEnrollmentFeeProjections({ contaId: options.contaId, limit })
      .then((result) => {
        if (result.failures > 0) {
          errors.push(
            `enrollment-fee-projection:${result.failures}:${result.failedSources.join(',')}`,
          );
        }
      })
      .catch((error) => {
        errors.push(
          `enrollment-fee-projection:${safeReconciliationError(error)}`,
        );
      });
    await alertService
      .alertReconciliationDrift(options.contaId, {
        payments: paymentDrift,
        subscriptions: subscriptionDrift,
        installments: installmentDrift,
      })
      .catch((err: unknown) => {
        console.warn('[reconciliation][alert-failed]', {
          contaId: options.contaId,
          error: err instanceof Error ? err.name : 'UNKNOWN_ERROR',
        });
      });
  }

  return buildResult({
    checkedPayments,
    reconciledPayments,
    paymentDrift,
    checkedSubscriptions,
    reconciledSubscriptions,
    subscriptionDrift,
    checkedInstallments,
    installmentDrift,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BILATERAL RECONCILIATION (Asaas → Local)
// ═══════════════════════════════════════════════════════════════════════════

export interface BilateralReconcileOptions {
  contaId: string;
  /** Dias para trás (padrão: 3) */
  windowDays?: number;
  /** Limite de pagamentos Asaas a consultar por página (padrão: 100) */
  pageSize?: number;
  /** Máximo de páginas a percorrer (padrão: 10) */
  maxPages?: number;
  /** Se true, apenas detecta drift sem aplicar correções */
  dryRun?: boolean;
}

export interface BilateralDriftItem {
  asaasPaymentId: string;
  asaasStatus: string;
  localChargeId: string | null;
  localStatus: string | null;
  driftType: 'MISSING_LOCAL' | 'STATUS_MISMATCH';
  externalReference: string | null;
}

export interface BilateralReconcileResult {
  contaId: string;
  dryRun: boolean;
  asaasPaymentsScanned: number;
  driftItems: BilateralDriftItem[];
  reconciled: number;
  errors: string[];
  generatedAt: Date;
}

const DEFAULT_BILATERAL_WINDOW_DAYS = 3;
const DEFAULT_BILATERAL_PAGE_SIZE = 100;
const DEFAULT_BILATERAL_MAX_PAGES = 10;

/**
 * Reconciliação bilateral: varre pagamentos no Asaas e compara com registros locais.
 * Detecta:
 * - Pagamentos existentes no Asaas sem Charge local correspondente (`MISSING_LOCAL`)
 * - Pagamentos com status divergente entre Asaas e local (`STATUS_MISMATCH`)
 *
 * Para STATUS_MISMATCH com dryRun=false, injeta webhook sintético via handlePaymentWebhook
 * para corrigir o estado local.
 *
 * Para MISSING_LOCAL, apenas registra — criação de Charge local exige contexto de matrícula/plano
 * que não pode ser inferido automaticamente.
 */
export async function reconcileBilateral(
  options: BilateralReconcileOptions,
): Promise<BilateralReconcileResult> {
  const now = new Date();
  const windowDays = options.windowDays ?? DEFAULT_BILATERAL_WINDOW_DAYS;
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? DEFAULT_BILATERAL_PAGE_SIZE));
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_BILATERAL_MAX_PAGES);
  const dryRun = options.dryRun ?? false;

  const errors: string[] = [];
  const driftItems: BilateralDriftItem[] = [];
  let asaasPaymentsScanned = 0;
  let reconciled = 0;

  const credentials = await loadAsaasCredentials(options.contaId);
  if (!credentials?.apiKey) {
    return {
      contaId: options.contaId,
      dryRun,
      asaasPaymentsScanned: 0,
      driftItems: [],
      reconciled: 0,
      errors: ['CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'],
      generatedAt: now,
    };
  }

  const since = new Date(now);
  since.setDate(since.getDate() - windowDays);
  const sinceStr = since.toISOString().slice(0, 10); // YYYY-MM-DD

  // Paginar pelo Asaas
  for (let page = 0; page < maxPages; page++) {
    let response;
    try {
      recordAsaasReadIntent('RECONCILIATION');
      response = await listPayments({
        apiKey: credentials.apiKey,
        offset: page * pageSize,
        limit: pageSize,
        'dateCreated[ge]': sinceStr,
      });
    } catch (error) {
      errors.push(`listPayments:page${page}:${error instanceof Error ? error.message : String(error)}`);
      break;
    }

    const payments: AsaasPayment[] = response.data;
    asaasPaymentsScanned += payments.length;

    for (const payment of payments) {
      try {
        if (payment.deleted) {
          const localCharge = await prisma.charge.findFirst({
            where: {
              contaId: options.contaId,
              asaasPaymentId: payment.id,
            },
            select: { id: true, status: true, externalReference: true },
          });

          if (localCharge && localCharge.status !== 'CANCELED') {
            if (!dryRun) {
              await handlePaymentWebhook(options.contaId, {
                event: 'PAYMENT_DELETED',
                payment: {
                  id: payment.id,
                  status: 'DELETED',
                  deleted: true,
                  value: Number(payment.value ?? 0),
                  netValue: Number(payment.netValue ?? payment.value ?? 0),
                  originalValue: typeof payment.originalValue === 'number' ? payment.originalValue : null,
                  externalReference: payment.externalReference ?? localCharge.externalReference ?? undefined,
                  subscription: payment.subscription ?? null,
                  installment: payment.installment ?? null,
                  installmentNumber: null,
                  dueDate: payment.dueDate ?? null,
                  paymentDate: payment.paymentDate ?? null,
                  clientPaymentDate: payment.clientPaymentDate ?? null,
                  creditDate: payment.creditDate ?? null,
                  estimatedCreditDate: payment.estimatedCreditDate ?? null,
                  billingType: payment.billingType ?? null,
                },
              });
            }
            driftItems.push({
              asaasPaymentId: payment.id,
              asaasStatus: 'DELETED',
              localChargeId: localCharge.id,
              localStatus: localCharge.status,
              driftType: 'STATUS_MISMATCH',
              externalReference: payment.externalReference ?? null,
            });
          }
          continue;
        }

        // Buscar Charge local pelo asaasPaymentId
        const paymentStatus = resolveRemotePaymentSnapshotStatus(payment);
        const localCharge = await prisma.charge.findFirst({
          where: {
            contaId: options.contaId,
            asaasPaymentId: payment.id,
          },
          select: { id: true, status: true },
        });

        if (!localCharge) {
          // Não existe localmente — registrar drift
          driftItems.push({
            asaasPaymentId: payment.id,
            asaasStatus: paymentStatus,
            localChargeId: null,
            localStatus: null,
            driftType: 'MISSING_LOCAL',
            externalReference: payment.externalReference ?? null,
          });
          if (!dryRun) {
            await upsertFinanceReconciliationIssue({
              contaId: options.contaId,
              entityType: 'PAYMENT',
              entityId: null,
              asaasId: payment.id,
              issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
              severity: 'HIGH',
              localStatus: null,
              remoteStatus: paymentStatus,
              metadata: {
                asaasStatus: paymentStatus,
                externalReference: payment.externalReference ?? null,
                source: 'reconcileBilateral',
              },
            });
          }
          continue;
        }

        // Comparar status
        const expectedLocalStatus = mapAsaasToChargeStatus(paymentStatus);
        if (expectedLocalStatus !== localCharge.status) {
          driftItems.push({
            asaasPaymentId: payment.id,
            asaasStatus: paymentStatus,
            localChargeId: localCharge.id,
            localStatus: localCharge.status,
            driftType: 'STATUS_MISMATCH',
            externalReference: payment.externalReference ?? null,
          });
          if (!dryRun) {
            await upsertFinanceReconciliationIssue({
              contaId: options.contaId,
              entityType: 'CHARGE',
              entityId: localCharge.id,
              asaasId: payment.id,
              issueType: 'PAYMENT_STATUS_DRIFT',
              severity: 'HIGH',
              localStatus: localCharge.status,
              remoteStatus: expectedLocalStatus,
              metadata: {
                asaasStatus: paymentStatus,
                externalReference: payment.externalReference ?? null,
                source: 'reconcileBilateral',
              },
            });
            try {
              const event = PAYMENT_EVENT_BY_STATUS[paymentStatus] ?? 'PAYMENT_UPDATED';
              await handlePaymentWebhook(options.contaId, {
                event,
                eventId: `reconciliation:${payment.id}:${paymentStatus}`,
                source: 'RECONCILIATION',
                providerOccurredAt: payment.dateCreated ? new Date(payment.dateCreated) : null,
                payment: {
                  id: payment.id,
                  status: paymentStatus as never,
                  value: Number(payment.value ?? 0),
                  netValue: Number(payment.netValue ?? payment.value ?? 0),
                  originalValue: typeof payment.originalValue === 'number' ? payment.originalValue : null,
                  externalReference: payment.externalReference ?? undefined,
                  subscription: payment.subscription ?? null,
                  installment: payment.installment ?? null,
                  installmentNumber: null,
                  dueDate: payment.dueDate ?? null,
                  paymentDate: payment.paymentDate ?? null,
                  clientPaymentDate: payment.clientPaymentDate ?? null,
                  creditDate: payment.creditDate ?? null,
                  estimatedCreditDate: payment.estimatedCreditDate ?? null,
                  billingType: payment.billingType ?? null,
                  deleted: payment.deleted ?? false,
                },
              });
              reconciled += 1;
            } catch (error) {
              errors.push(`reconcile:${payment.id}:${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      } catch (error) {
        errors.push(`check:${payment.id}:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!response.hasMore) break;
  }

  if (!dryRun) {
    await alertService
      .alertReconciliationDrift(options.contaId, {
        payments: driftItems.length,
        subscriptions: 0,
        installments: 0,
      })
      .catch((err: unknown) => {
        console.warn('[bilateral-reconciliation][alert-failed]', { contaId: options.contaId, err });
      });
  }

  return {
    contaId: options.contaId,
    dryRun,
    asaasPaymentsScanned,
    driftItems,
    reconciled,
    errors,
    generatedAt: now,
  };
}
