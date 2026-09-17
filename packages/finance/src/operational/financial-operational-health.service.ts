import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

export type EvaluateFinancialOperationalHealthInput = {
  contaId?: string;
  maxAccounts?: number;
};

export type FinancialOperationalMetric = {
  key: string;
  value: number;
  threshold: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
};

export type FinancialOperationalAccountHealth = {
  contaId: string;
  metrics: FinancialOperationalMetric[];
  openedAlerts: number;
  resolvedAlerts: number;
};

export type EvaluateFinancialOperationalHealthResult = {
  generatedAt: Date;
  accounts: FinancialOperationalAccountHealth[];
};

export type FinancialOperationalAlertRecord = Awaited<
  ReturnType<typeof listOpenFinancialOperationalAlerts>
>[number];

type AlertCandidate = {
  key: string;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  metricValue: number;
  threshold: number;
  metadata?: Prisma.InputJsonValue;
};

const MANAGED_ALERT_KEYS = [
  'webhook_backlog',
  'webhook_stale',
  'webhook_failed',
  'notification_outbox_failed',
  'notification_outbox_backlog',
  'notification_sync_outbox_failed',
  'notification_sync_outbox_backlog',
  'asaas_job_failed',
  'asaas_job_stale',
  'customer_snapshot_missing',
  'billing_read_model_lag',
  'finance_aggregate_missing',
];

/**
 * Reads the local webhook credential state without exposing the stored hash.
 * Keeping this query in the finance package prevents admin route handlers from
 * reaching directly into the persistence model.
 */
export async function hasStoredAsaasWebhookAuthTokenHash(
  contaId: string,
  db: typeof prisma = prisma,
): Promise<boolean> {
  const account = await db.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: { webhookAuthTokenHash: true },
  });

  return Boolean(account?.webhookAuthTokenHash);
}

/**
 * Returns only open operational alerts for one tenant. The tenant predicate is
 * intentionally part of the package boundary so callers cannot omit it.
 */
export async function listOpenFinancialOperationalAlerts(
  contaId: string,
  limit = 100,
  db: typeof prisma = prisma,
) {
  const safeLimit = clampInt(limit, 100, 1, 100);

  return db.financialOperationalAlert.findMany({
    where: {
      contaId,
      status: 'OPEN',
    },
    orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
    take: safeLimit,
  });
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function metric(
  key: string,
  value: number,
  threshold: number,
  criticalThreshold = Number.POSITIVE_INFINITY,
): FinancialOperationalMetric {
  return {
    key,
    value,
    threshold,
    severity: value >= criticalThreshold ? 'CRITICAL' : value >= threshold ? 'WARNING' : 'INFO',
  };
}

async function listContaIds(maxAccounts: number): Promise<string[]> {
  const rows = await prisma.conta.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: 'asc' },
    take: maxAccounts,
    select: { id: true },
  });

  return rows.map((row) => row.id);
}

type OperationalMetricRow = {
  webhookBacklog: bigint;
  staleWebhooks: bigint;
  failedWebhooks: bigint;
  notificationBacklog: bigint;
  failedNotifications: bigint;
  notificationSyncBacklog: bigint;
  failedNotificationSyncs: bigint;
  failedJobs: bigint;
  staleJobs: bigint;
  customerWithAsaas: bigint;
  customerSnapshots: bigint;
  billingReadModelLag: bigint;
  transactionCount: bigint;
  freshDailyAggregates: bigint;
};

/**
 * Consolida as métricas de saúde em uma ida ao banco por tenant.
 * As subconsultas continuam explicitamente filtradas por contaId; a
 * consolidação reduz round trips sem enfraquecer RLS ou isolamento.
 */
export async function collectFinancialOperationalMetrics(
  contaId: string,
  db: typeof prisma = prisma,
): Promise<FinancialOperationalMetric[]> {
  const now = Date.now();
  const staleWebhookBefore = new Date(now - 10 * 60_000);
  const staleJobBefore = new Date(now - 15 * 60_000);
  const aggregateStaleBefore = new Date(now - 24 * 60 * 60_000);

  const rows = await db.$queryRaw<OperationalMetricRow[]>`
    SELECT
      (SELECT COUNT(*) FROM "WebhookAsaas" WHERE "contaId" = ${contaId} AND "status" IN ('PENDENTE', 'ERRO')) AS "webhookBacklog",
      (SELECT COUNT(*) FROM "WebhookAsaas" WHERE "contaId" = ${contaId} AND "status" IN ('PENDENTE', 'ERRO') AND "recebidoEm" < ${staleWebhookBefore}) AS "staleWebhooks",
      (SELECT COUNT(*) FROM "WebhookAsaas" WHERE "contaId" = ${contaId} AND "status" IN ('EXAURIDO', 'FAILED')) AS "failedWebhooks",
      (SELECT COUNT(*) FROM "AsaasNotificationPreferenceOutbox" WHERE "contaId" = ${contaId} AND "status" IN ('PENDING', 'FAILED', 'PROCESSING')) AS "notificationBacklog",
      (SELECT COUNT(*) FROM "AsaasNotificationPreferenceOutbox" WHERE "contaId" = ${contaId} AND "status" = 'FAILED') AS "failedNotifications",
      (SELECT COUNT(*) FROM "AsaasNotificationSyncOutbox" WHERE "contaId" = ${contaId} AND "status" IN ('PENDING', 'FAILED', 'PROCESSING')) AS "notificationSyncBacklog",
      (SELECT COUNT(*) FROM "AsaasNotificationSyncOutbox" WHERE "contaId" = ${contaId} AND "status" IN ('FAILED', 'EXHAUSTED')) AS "failedNotificationSyncs",
      (SELECT COUNT(*) FROM "AsaasIntegrationJob" WHERE "contaId" = ${contaId} AND "status" = 'FAILED') AS "failedJobs",
      (SELECT COUNT(*) FROM "AsaasIntegrationJob" WHERE "contaId" = ${contaId} AND "status" IN ('PENDING', 'PROCESSING') AND "updatedAt" < ${staleJobBefore}) AS "staleJobs",
      (SELECT COUNT(*) FROM "Customer" WHERE "contaId" = ${contaId} AND "asaasCustomerId" IS NOT NULL) AS "customerWithAsaas",
      (SELECT COUNT(*) FROM "AsaasCustomerSnapshot" WHERE "contaId" = ${contaId} AND "deleted" = false) AS "customerSnapshots",
      (SELECT COUNT(*) FROM (
        SELECT s."id"
        FROM "Subscription" s
        LEFT JOIN "FinanceSubscriptionReadModel" rm
          ON rm."contaId" = s."contaId"
         AND rm."sourceKind" = 'ACADEMIC_SUBSCRIPTION'
         AND rm."sourceId" = s."id"
        WHERE s."contaId" = ${contaId}
          AND (rm."id" IS NULL OR rm."projectedAt" < s."updatedAt")
        UNION ALL
        SELECT ss."id"
        FROM "StandaloneSubscription" ss
        LEFT JOIN "FinanceSubscriptionReadModel" rm
          ON rm."contaId" = ss."contaId"
         AND rm."sourceKind" = 'STANDALONE_SUBSCRIPTION'
         AND rm."sourceId" = ss."id"
        WHERE ss."contaId" = ${contaId}
          AND (rm."id" IS NULL OR rm."projectedAt" < ss."updatedAt")
        UNION ALL
        SELECT ip."id"
        FROM "InstallmentPlan" ip
        LEFT JOIN "FinanceInstallmentPlanReadModel" rm
          ON rm."contaId" = ip."contaId"
         AND rm."sourceKind" = 'ACADEMIC_INSTALLMENT'
         AND rm."sourceId" = ip."id"
        WHERE ip."contaId" = ${contaId}
          AND (rm."id" IS NULL OR rm."projectedAt" < ip."updatedAt")
        UNION ALL
        SELECT sip."id"
        FROM "StandaloneInstallmentPlan" sip
        LEFT JOIN "FinanceInstallmentPlanReadModel" rm
          ON rm."contaId" = sip."contaId"
         AND rm."sourceKind" = 'STANDALONE_INSTALLMENT'
         AND rm."sourceId" = sip."id"
        WHERE sip."contaId" = ${contaId}
          AND (rm."id" IS NULL OR rm."projectedAt" < sip."updatedAt")
      ) lag) AS "billingReadModelLag",
      (SELECT COUNT(*) FROM "FinancialTransactionSnapshot" WHERE "contaId" = ${contaId}) AS "transactionCount",
      (SELECT COUNT(*) FROM "FinanceDailyAggregate" WHERE "contaId" = ${contaId} AND "calculatedAt" >= ${aggregateStaleBefore}) AS "freshDailyAggregates"
  `;

  const row = rows[0];
  if (!row) throw new Error('Não foi possível coletar métricas financeiras.');

  const webhookBacklog = Number(row.webhookBacklog);
  const staleWebhooks = Number(row.staleWebhooks);
  const failedWebhooks = Number(row.failedWebhooks);
  const notificationBacklog = Number(row.notificationBacklog);
  const failedNotifications = Number(row.failedNotifications);
  const notificationSyncBacklog = Number(row.notificationSyncBacklog);
  const failedNotificationSyncs = Number(row.failedNotificationSyncs);
  const failedJobs = Number(row.failedJobs);
  const staleJobs = Number(row.staleJobs);
  const customerWithAsaas = Number(row.customerWithAsaas);
  const customerSnapshots = Number(row.customerSnapshots);
  const billingReadModelLag = Number(row.billingReadModelLag);
  const transactionCount = Number(row.transactionCount);
  const freshDailyAggregates = Number(row.freshDailyAggregates);

  const missingCustomerSnapshots = Math.max(0, customerWithAsaas - customerSnapshots);
  const aggregateMissing = transactionCount > 0 && freshDailyAggregates === 0 ? 1 : 0;

  return [
    metric('webhook_backlog', webhookBacklog, 50, 250),
    metric('webhook_stale', staleWebhooks, 1, 10),
    metric('webhook_failed', failedWebhooks, 1, 5),
    metric('notification_outbox_backlog', notificationBacklog, 100, 1_000),
    metric('notification_outbox_failed', failedNotifications, 1, 20),
    metric('notification_sync_outbox_backlog', notificationSyncBacklog, 10, 100),
    metric('notification_sync_outbox_failed', failedNotificationSyncs, 1, 10),
    metric('asaas_job_failed', failedJobs, 1, 20),
    metric('asaas_job_stale', staleJobs, 1, 20),
    metric('customer_snapshot_missing', missingCustomerSnapshots, 1, 50),
    metric('billing_read_model_lag', billingReadModelLag, 1, 100),
    metric('finance_aggregate_missing', aggregateMissing, 1, 1),
  ];
}

function alertFromMetric(metricItem: FinancialOperationalMetric): AlertCandidate | null {
  if (metricItem.severity === 'INFO') return null;

  const labels: Record<string, { title: string; description: string }> = {
    webhook_backlog: {
      title: 'Fila de webhooks acumulando',
      description: 'Eventos do Asaas estão aguardando processamento local.',
    },
    webhook_stale: {
      title: 'Webhook parado há mais de 10 minutos',
      description: 'Há eventos antigos sem processamento, com risco de penalização ou fila pausada.',
    },
    webhook_failed: {
      title: 'Webhook em falha definitiva',
      description: 'Há eventos com status de falha/exaustão que precisam de reprocessamento.',
    },
    notification_outbox_failed: {
      title: 'Outbox de notificações Asaas com falhas',
      description: 'Preferências de notificação de clientes falharam e serão retentadas.',
    },
    notification_outbox_backlog: {
      title: 'Outbox de notificações Asaas acumulando',
      description: 'Há muitas preferências de notificação aguardando aplicação.',
    },
    notification_sync_outbox_failed: {
      title: 'Sincronizações de notificações em falha',
      description: 'Há clientes com canais de notificação que não foram aplicados após tentativas de retry.',
    },
    notification_sync_outbox_backlog: {
      title: 'Fila de notificações de cobranças acumulando',
      description: 'Há sincronizações explícitas de canais aguardando processamento.',
    },
    asaas_job_failed: {
      title: 'Jobs Asaas com falha',
      description: 'Comandos financeiros assíncronos falharam e precisam de retry ou análise.',
    },
    asaas_job_stale: {
      title: 'Jobs Asaas parados',
      description: 'Comandos financeiros estão pendentes/processando há tempo acima do esperado.',
    },
    customer_snapshot_missing: {
      title: 'Snapshots de customers incompletos',
      description: 'Há clientes Asaas locais sem snapshot remoto recente.',
    },
    billing_read_model_lag: {
      title: 'Read models de cobrança recorrente defasados',
      description: 'Assinaturas ou parcelamentos mudaram e ainda não foram projetados para leitura.',
    },
    finance_aggregate_missing: {
      title: 'Agregados financeiros ausentes',
      description: 'Há snapshots de extrato sem agregados diários recentes.',
    },
  };

  const label = labels[metricItem.key];
  if (!label) return null;

  return {
    key: metricItem.key,
    severity: metricItem.severity,
    title: label.title,
    description: label.description,
    metricValue: metricItem.value,
    threshold: metricItem.threshold,
    metadata: {
      key: metricItem.key,
      source: 'evaluateFinancialOperationalHealth',
    },
  };
}

async function persistAlerts(contaId: string, metrics: FinancialOperationalMetric[]) {
  const now = new Date();
  const alertCandidates = metrics
    .map(alertFromMetric)
    .filter((alert): alert is AlertCandidate => Boolean(alert));
  const openKeys = new Set(alertCandidates.map((alert) => alert.key));

  for (const alert of alertCandidates) {
    await prisma.financialOperationalAlert.upsert({
      where: {
        uq_fin_operational_alert_conta_key: {
          contaId,
          alertKey: alert.key,
        },
      },
      update: {
        severity: alert.severity,
        status: 'OPEN',
        title: alert.title,
        description: alert.description,
        metricValue: alert.metricValue,
        threshold: alert.threshold,
        metadata: alert.metadata,
        lastSeenAt: now,
        resolvedAt: null,
      },
      create: {
        contaId,
        alertKey: alert.key,
        severity: alert.severity,
        status: 'OPEN',
        title: alert.title,
        description: alert.description,
        metricValue: alert.metricValue,
        threshold: alert.threshold,
        metadata: alert.metadata,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  }

  const resolvedKeys = MANAGED_ALERT_KEYS.filter((key) => !openKeys.has(key));
  const resolved = resolvedKeys.length
    ? await prisma.financialOperationalAlert.updateMany({
        where: {
          contaId,
          alertKey: { in: resolvedKeys },
          status: 'OPEN',
        },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          lastSeenAt: now,
        },
      })
    : { count: 0 };

  return {
    openedAlerts: alertCandidates.length,
    resolvedAlerts: resolved.count,
  };
}

export async function evaluateFinancialOperationalHealth(
  input: EvaluateFinancialOperationalHealthInput = {},
): Promise<EvaluateFinancialOperationalHealthResult> {
  const maxAccounts = clampInt(input.maxAccounts, 50, 1, 200);
  const contaIds = input.contaId ? [input.contaId] : await listContaIds(maxAccounts);
  const accounts: FinancialOperationalAccountHealth[] = [];

  for (const contaId of contaIds) {
    const metrics = await collectFinancialOperationalMetrics(contaId);
    const persisted = await persistAlerts(contaId, metrics);
    accounts.push({
      contaId,
      metrics,
      ...persisted,
    });
  }

  return {
    generatedAt: new Date(),
    accounts,
  };
}
