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
import type { Prisma } from '@prisma/client';
import { getInstallment, getPayment, getSubscription, listInstallmentPayments, listPayments } from '@alusa/asaas';
import type { AsaasPayment } from '@alusa/asaas';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { alertService } from '../foundation/alert-channel';
import { mapAsaasToChargeStatus } from '../core';
import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { handlePaymentWebhook } from './payment-webhook-handler';

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
  windowHours?: number;
  limit?: number;
  dryRun?: boolean;
}

export interface AsaasReconcileResult {
  contaId: string;
  dryRun: boolean;
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
const DEFAULT_RECONCILE_WINDOW_HOURS = 24;
const DEFAULT_RECONCILE_LIMIT = 200;
const DEFAULT_PROCESSING_TIMEOUT_MINUTES = 5;

/** Status que indicam cobrança em estado não-final (pode ter eventos pendentes) */
const NON_FINAL_STATUSES = ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO'];

const PAYMENT_EVENT_BY_STATUS: Record<string, string> = {
  PENDING: 'PAYMENT_UPDATED',
  RECEIVED: 'PAYMENT_RECEIVED',
  CONFIRMED: 'PAYMENT_CONFIRMED',
  RECEIVED_IN_CASH: 'PAYMENT_RECEIVED_IN_CASH',
  OVERDUE: 'PAYMENT_OVERDUE',
  REFUNDED: 'PAYMENT_REFUNDED',
  REFUND_REQUESTED: 'PAYMENT_REFUND_REQUESTED',
  REFUND_IN_PROGRESS: 'PAYMENT_REFUND_IN_PROGRESS',
  DELETED: 'PAYMENT_DELETED',
};

// ═══════════════════════════════════════════════════════════════════════════
// GAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta cobranças que podem estar com eventos faltando.
 * Critérios:
 * - Cobrança em status não-final
 * - Vencimento dentro da janela (ou já vencido)
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

  // Cobranças em status não-final com vencimento na janela
  // Nota: Cobranca não tem contaId direto, usa join via Matricula → Aluno
  const chargesWithMissingFinalStatus = await prisma.cobranca.findMany({
    where: {
      matricula: {
        aluno: { contaId },
      },
      status: { in: NON_FINAL_STATUSES as Prisma.EnumStatusCobrancaFilter['in'] },
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
  });

  // Para cada cobrança, verificar último webhook recebido
  const chargesWithWebhookInfo = await Promise.all(
    chargesWithMissingFinalStatus.map(async (charge) => {
      if (!charge.asaasPaymentId) {
        return {
          id: charge.id,
          asaasPaymentId: charge.asaasPaymentId,
          status: charge.status,
          dueDate: charge.vencimento,
          lastWebhookAt: null,
        };
      }

      const lastWebhook = await prisma.webhookAsaas.findFirst({
        where: {
          contaId,
          asaasPaymentId: charge.asaasPaymentId,
        },
        orderBy: { recebidoEm: 'desc' },
        select: { recebidoEm: true },
      });

      return {
        id: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        status: charge.status,
        dueDate: charge.vencimento,
        lastWebhookAt: lastWebhook?.recebidoEm ?? null,
      };
    })
  );

  // Filtrar cobranças sem webhook recente (24h)
  const oneDayAgo = new Date(now);
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const chargesWithGap = chargesWithWebhookInfo.filter(
    (c) => !c.lastWebhookAt || c.lastWebhookAt < oneDayAgo
  );

  // Assinaturas ativas sem eventos recentes
  const subscriptionsWithMissingEvents = await prisma.subscription.findMany({
    where: {
      contaId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      asaasSubscriptionId: true,
      status: true,
    },
    take: chargeLimit,
  });

  const subscriptionsWithWebhookInfo = await Promise.all(
    subscriptionsWithMissingEvents.map(async (sub) => {
      if (!sub.asaasSubscriptionId) {
        return {
          id: sub.id,
          asaasSubscriptionId: sub.asaasSubscriptionId,
          status: sub.status,
          lastWebhookAt: null,
        };
      }

      const lastWebhook = await prisma.webhookAsaas.findFirst({
        where: {
          contaId,
          asaasSubscriptionId: sub.asaasSubscriptionId,
        },
        orderBy: { recebidoEm: 'desc' },
        select: { recebidoEm: true },
      });

      return {
        id: sub.id,
        asaasSubscriptionId: sub.asaasSubscriptionId,
        status: sub.status,
        lastWebhookAt: lastWebhook?.recebidoEm ?? null,
      };
    })
  );

  return {
    chargesWithMissingFinalStatus: chargesWithGap,
    subscriptionsWithMissingEvents: subscriptionsWithWebhookInfo.filter(
      (s) => !s.lastWebhookAt || s.lastWebhookAt < oneDayAgo
    ),
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

  // Cobranca não tem contaId direto - usa join via Matricula → Aluno
  const relatedCharge = webhook.asaasPaymentId
    ? await prisma.cobranca.findFirst({
        where: {
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
  const limit = Math.min(500, Math.max(1, options.limit ?? 200));

  const where: Prisma.WebhookAsaasWhereInput = {
    status: 'ERRO',
    tentativas: { gte: maxAttempts },
    ...(options.contaId ? { contaId: options.contaId } : {}),
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

/**
 * Reconciliação ativa com Asaas:
 * - Pagamentos: compara snapshot remoto e aplica webhook sintético quando há drift.
 * - Assinaturas: sincroniza status remoto.
 * - Parcelamentos: detecta drift de contagem entre pagamentos remotos e locais.
 */
export async function reconcileWithAsaas(
  options: AsaasReconcileOptions
): Promise<AsaasReconcileResult> {
  const now = new Date();
  const since = new Date(now.getTime() - (Math.max(1, options.windowHours ?? DEFAULT_RECONCILE_WINDOW_HOURS) * 60 * 60 * 1000));
  const limit = Math.min(1000, Math.max(1, options.limit ?? DEFAULT_RECONCILE_LIMIT));
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];

  const credentials = await loadAsaasCredentials(options.contaId);
  if (!credentials?.apiKey) {
    return {
      contaId: options.contaId,
      dryRun,
      checkedPayments: 0,
      reconciledPayments: 0,
      paymentDrift: 0,
      checkedSubscriptions: 0,
      reconciledSubscriptions: 0,
      subscriptionDrift: 0,
      checkedInstallments: 0,
      installmentDrift: 0,
      errors: ['CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'],
      generatedAt: now,
    };
  }

  let checkedPayments = 0;
  let reconciledPayments = 0;
  let paymentDrift = 0;
  let checkedSubscriptions = 0;
  let reconciledSubscriptions = 0;
  let subscriptionDrift = 0;
  let checkedInstallments = 0;
  let installmentDrift = 0;

  const [charges, subscriptions, installmentPlans, standaloneInstallments] = await Promise.all([
    prisma.charge.findMany({
      where: {
        contaId: options.contaId,
        asaasPaymentId: { not: null },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        asaasPaymentId: true,
        status: true,
        externalReference: true,
      },
    }),
    prisma.subscription.findMany({
      where: {
        contaId: options.contaId,
        asaasSubscriptionId: { not: null },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        asaasSubscriptionId: true,
        status: true,
      },
    }),
    prisma.installmentPlan.findMany({
      where: {
        contaId: options.contaId,
        asaasInstallmentId: { not: null },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, asaasInstallmentId: true },
    }),
    prisma.standaloneInstallmentPlan.findMany({
      where: {
        contaId: options.contaId,
        asaasInstallmentId: { not: null },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, asaasInstallmentId: true },
    }),
  ]);

  for (const charge of charges) {
    if (!charge.asaasPaymentId) continue;
    checkedPayments += 1;
    try {
      recordAsaasReadIntent('RECONCILIATION');
      const remote = await getPayment({ apiKey: credentials.apiKey, paymentId: charge.asaasPaymentId });
      const remoteLocalStatus = mapAsaasToChargeStatus(remote.status);
      if (remoteLocalStatus !== charge.status) {
        paymentDrift += 1;
        if (!dryRun) {
          const event = PAYMENT_EVENT_BY_STATUS[remote.status] ?? 'PAYMENT_UPDATED';
          await handlePaymentWebhook(options.contaId, {
            event,
            payment: {
              id: remote.id,
              status: remote.status as never,
              value: Number(remote.value ?? 0),
              netValue: Number(remote.netValue ?? remote.value ?? 0),
              originalValue: typeof remote.originalValue === 'number' ? remote.originalValue : null,
              externalReference: remote.externalReference,
              subscription: remote.subscription ?? null,
              installment: remote.installment ?? null,
              installmentNumber: null,
              dueDate: remote.dueDate ?? null,
              paymentDate: remote.paymentDate ?? null,
              clientPaymentDate: remote.clientPaymentDate ?? null,
              creditDate: remote.creditDate ?? null,
              estimatedCreditDate: remote.estimatedCreditDate ?? null,
              billingType: remote.billingType ?? null,
            },
          });
          reconciledPayments += 1;
        }
      }
    } catch (error) {
      errors.push(`payment:${charge.asaasPaymentId}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const sub of subscriptions) {
    if (!sub.asaasSubscriptionId) continue;
    checkedSubscriptions += 1;
    try {
      recordAsaasReadIntent('RECONCILIATION');
      const remote = await getSubscription({
        apiKey: credentials.apiKey,
        subscriptionId: sub.asaasSubscriptionId,
      });
      const nextStatus = mapAsaasSubscriptionStatus({
        status: remote.status,
        deleted: remote.deleted,
      });

      if (nextStatus !== sub.status) {
        subscriptionDrift += 1;
        if (!dryRun) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: nextStatus,
              statusUpdatedAt: new Date(),
            },
          });
          reconciledSubscriptions += 1;
        }
      }
    } catch (error) {
      errors.push(`subscription:${sub.asaasSubscriptionId}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const allInstallments = [
    ...installmentPlans.map((plan) => ({ id: plan.id, asaasInstallmentId: plan.asaasInstallmentId!, source: 'ACADEMIC' as const })),
    ...standaloneInstallments.map((plan) => ({ id: plan.id, asaasInstallmentId: plan.asaasInstallmentId!, source: 'STANDALONE' as const })),
  ];

  for (const plan of allInstallments) {
    checkedInstallments += 1;
    try {
      await getInstallment({ apiKey: credentials.apiKey, installmentId: plan.asaasInstallmentId });
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
      }
    } catch (error) {
      errors.push(`installment:${plan.asaasInstallmentId}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!dryRun) {
    await alertService
      .alertReconciliationDrift(options.contaId, {
        payments: paymentDrift,
        subscriptions: subscriptionDrift,
        installments: installmentDrift,
      })
      .catch((err: unknown) => {
        console.warn('[reconciliation][alert-failed]', { contaId: options.contaId, err });
      });
  }

  return {
    contaId: options.contaId,
    dryRun,
    checkedPayments,
    reconciledPayments,
    paymentDrift,
    checkedSubscriptions,
    reconciledSubscriptions,
    subscriptionDrift,
    checkedInstallments,
    installmentDrift,
    errors,
    generatedAt: now,
  };
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
      // Ignorar deletados
      if (payment.deleted) continue;

      try {
        // Buscar Charge local pelo asaasPaymentId
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
            asaasStatus: payment.status,
            localChargeId: null,
            localStatus: null,
            driftType: 'MISSING_LOCAL',
            externalReference: payment.externalReference ?? null,
          });
          continue;
        }

        // Comparar status
        const expectedLocalStatus = mapAsaasToChargeStatus(payment.status);
        if (expectedLocalStatus !== localCharge.status) {
          driftItems.push({
            asaasPaymentId: payment.id,
            asaasStatus: payment.status,
            localChargeId: localCharge.id,
            localStatus: localCharge.status,
            driftType: 'STATUS_MISMATCH',
            externalReference: payment.externalReference ?? null,
          });

          if (!dryRun) {
            try {
              const event = PAYMENT_EVENT_BY_STATUS[payment.status] ?? 'PAYMENT_UPDATED';
              await handlePaymentWebhook(options.contaId, {
                event,
                payment: {
                  id: payment.id,
                  status: payment.status as never,
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
