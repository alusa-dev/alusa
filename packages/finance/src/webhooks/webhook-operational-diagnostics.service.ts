import { loadAsaasCredentials, prisma } from '@alusa/database';

import {
  calculateRegistryMetrics,
  evaluateWebhookSLOs,
  type WebhookSLOResult,
} from './webhook-observability.service';
import {
  detectWebhookGaps,
  evaluateRetentionAlert,
  getWebhookQueueMetrics,
  type QueueMetricsResult,
  type RetentionAlert,
  type WebhookGapDetectionResult,
} from './webhook-reconciliation.service';
import {
  inspectWebhookProcessingRuntimeStatus,
  inspectWebhookUrlRuntimeStatus,
  type WebhookProcessingRuntimeStatus,
  type WebhookUrlRuntimeStatus,
} from './webhook-runtime-config';
import {
  getWebhookConfigDriftStatus,
  type WebhookConfigDriftStatus,
} from './webhook-config-drift.service';
import { getWebhookHealthStatus, type WebhookHealthStatus } from './webhook-health.service';
import { hasWebhookAuthTokenConfig } from '../use-cases/asaas-account/webhook-auth-token.server';

const ASAAS_WEBHOOK_READ_TIMEOUT_SECONDS = 10;
const ASAAS_WEBHOOK_FAILURES_BEFORE_PAUSE = 15;

export interface WebhookOperationalRecommendation {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface WebhookOperationalDiagnostics {
  contaId: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  generatedAt: Date;
  env: {
    featureAsaasEnabled: boolean;
    hasWebhookSecret: boolean;
    webhookUrl: WebhookUrlRuntimeStatus;
    processing: WebhookProcessingRuntimeStatus;
  };
  local: {
    asaasAccountId: string | null;
    financeProfileId: string | null;
    asaasAccountStatus: string | null;
    hasWebhookAuthTokenHash: boolean;
    hasSubaccountCredentials: boolean;
  };
  registry: ReturnType<typeof calculateRegistryMetrics>;
  remoteHealth: WebhookHealthStatus | null;
  drift: WebhookConfigDriftStatus | null;
  queue: QueueMetricsResult & { exhausted: number };
  retentionAlert: RetentionAlert | null;
  slo: WebhookSLOResult;
  gaps: WebhookGapDetectionResult | null;
  recommendations: WebhookOperationalRecommendation[];
}

export interface GetWebhookOperationalDiagnosticsOptions {
  contaId: string;
  includeGaps?: boolean;
  windowDays?: number;
}

export interface AsaasWebhookOperationalStatus {
  contaId: string | 'ALL';
  generatedAt: Date;
  pending: number;
  processing: number;
  errored: number;
  exhausted: number;
  processedLast24h: number;
  oldestPendingAt: Date | null;
  lagSeconds: number | null;
  highRetryBacklog: number;
  stuckProcessing: number;
  rejectionCountLast1h: number;
  rejectionCountLast24h: number;
  rejectionsByReason: Array<{ reason: string; count: number }>;
}

export interface GetAsaasWebhookOperationalStatusOptions {
  contaId?: string;
}

function pushRecommendation(
  target: WebhookOperationalRecommendation[],
  recommendation: WebhookOperationalRecommendation | null,
): void {
  if (!recommendation) return;
  if (target.some((item) => item.code === recommendation.code)) return;
  target.push(recommendation);
}

function fromBoolean(
  condition: boolean,
  recommendation: WebhookOperationalRecommendation,
): WebhookOperationalRecommendation | null {
  return condition ? recommendation : null;
}

function resolveDiagnosticsStatus(
  recommendations: WebhookOperationalRecommendation[],
): WebhookOperationalDiagnostics['status'] {
  if (recommendations.some((item) => item.severity === 'critical')) return 'ERROR';
  if (recommendations.some((item) => item.severity === 'warning')) return 'WARNING';
  return 'OK';
}

export async function getAsaasWebhookOperationalStatus(
  options: GetAsaasWebhookOperationalStatusOptions = {},
): Promise<AsaasWebhookOperationalStatus> {
  const generatedAt = new Date();
  const since1h = new Date(generatedAt.getTime() - 60 * 60 * 1000);
  const since24h = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

  const [queue, exhausted, processedLast24h, rejectionCountLast1h, rejectionCountLast24h, rejectionsByReasonRaw] =
    await Promise.all([
      getWebhookQueueMetrics({ contaId: options.contaId }),
      prisma.webhookAsaas.count({
        where: {
          ...(options.contaId ? { contaId: options.contaId } : {}),
          status: 'EXAURIDO',
        },
      }),
      prisma.webhookAsaas.count({
        where: {
          ...(options.contaId ? { contaId: options.contaId } : {}),
          status: 'PROCESSADO',
          processadoEm: { gte: since24h },
        },
      }),
      prisma.webhookAsaasRejection.count({
        where: {
          ...(options.contaId ? { contaId: options.contaId } : {}),
          recebidoEm: { gte: since1h },
        },
      }),
      prisma.webhookAsaasRejection.count({
        where: {
          ...(options.contaId ? { contaId: options.contaId } : {}),
          recebidoEm: { gte: since24h },
        },
      }),
      prisma.webhookAsaasRejection.groupBy({
        by: ['reason'],
        where: {
          ...(options.contaId ? { contaId: options.contaId } : {}),
          recebidoEm: { gte: since24h },
        },
        _count: { _all: true },
        orderBy: { _count: { reason: 'desc' } },
        take: 20,
      }),
    ]);

  return {
    contaId: options.contaId ?? 'ALL',
    generatedAt,
    pending: queue.pending,
    processing: queue.processing,
    errored: queue.errored,
    exhausted,
    processedLast24h,
    oldestPendingAt: queue.oldestPendingAt,
    lagSeconds: queue.lagSeconds,
    highRetryBacklog: queue.highRetryBacklog,
    stuckProcessing: queue.stuckProcessing,
    rejectionCountLast1h,
    rejectionCountLast24h,
    rejectionsByReason: rejectionsByReasonRaw.map((item) => ({
      reason: item.reason,
      count: item._count._all,
    })),
  };
}

export async function getWebhookOperationalDiagnostics(
  options: GetWebhookOperationalDiagnosticsOptions,
): Promise<WebhookOperationalDiagnostics> {
  const generatedAt = new Date();
  const featureAsaasEnabled = process.env.FEATURE_ASAAS === 'true';
  const hasWebhookSecret = hasWebhookAuthTokenConfig();
  const webhookUrl = inspectWebhookUrlRuntimeStatus();
  const processing = inspectWebhookProcessingRuntimeStatus();
  const registry = calculateRegistryMetrics();

  const [localAccount, credentials, queueBase, exhausted, remoteHealthResult, driftResult, gapsResult] =
    await Promise.all([
      prisma.asaasAccount.findFirst({
        where: { financeProfile: { contaId: options.contaId } },
        select: {
          asaasAccountId: true,
          financeProfileId: true,
          status: true,
          webhookAuthTokenHash: true,
        },
      }),
      loadAsaasCredentials(options.contaId).catch(() => null),
      getWebhookQueueMetrics({ contaId: options.contaId }).catch(() => ({
        contaId: options.contaId,
        backlog: 0,
        pending: 0,
        processing: 0,
        errored: 0,
        processed: 0,
        highRetryBacklog: 0,
        stuckProcessing: 0,
        oldestPendingAt: null,
        lagSeconds: null,
        generatedAt,
      })),
      prisma.webhookAsaas.count({
        where: { contaId: options.contaId, status: 'EXAURIDO' },
      }),
      getWebhookHealthStatus(options.contaId).catch(() => null),
      getWebhookConfigDriftStatus(options.contaId).catch(() => null),
      options.includeGaps
        ? detectWebhookGaps(options.contaId, { windowDays: options.windowDays ?? 7 }).catch(() => null)
        : Promise.resolve(null),
    ]);

  const queue = {
    ...queueBase,
    exhausted,
  };
  const retentionAlert = evaluateRetentionAlert(queue);
  const slo = evaluateWebhookSLOs(queue);
  const recommendations: WebhookOperationalRecommendation[] = [];

  pushRecommendation(
    recommendations,
    fromBoolean(!featureAsaasEnabled, {
      code: 'FEATURE_ASAAS_DISABLED',
      severity: 'critical',
      message: 'FEATURE_ASAAS está desabilitada.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!hasWebhookSecret, {
      code: 'WEBHOOK_SECRET_MISSING',
      severity: 'critical',
      message: 'ASAAS_WEBHOOK_AUTH_TOKEN ou ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não está configurada.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!processing.useAsyncQueue, {
      code: 'WEBHOOK_ASYNC_QUEUE_DISABLED',
      severity: processing.isProduction ? 'critical' : 'warning',
      message:
        `O Asaas aguarda resposta do webhook por cerca de ${ASAAS_WEBHOOK_READ_TIMEOUT_SECONDS}s; ` +
        'prefira sempre enfileirar e responder 200 após persistir o evento.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(processing.isProduction && process.env.ASAAS_WEBHOOK_IP_CHECK !== 'strict', {
      code: 'WEBHOOK_IP_STRICT_NOT_ENABLED',
      severity: 'info',
      message:
        'Em produção, avalie ASAAS_WEBHOOK_IP_CHECK=strict após validar que o proxy repassa IPs oficiais do Asaas corretamente.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(processing.isProduction && processing.inlineDrain, {
      code: 'WEBHOOK_INLINE_DRAIN_PRODUCTION',
      severity: 'warning',
      message:
        `Após ${ASAAS_WEBHOOK_FAILURES_BEFORE_PAUSE} falhas consecutivas o Asaas pode pausar a fila; ` +
        'mantenha processamento pesado fora da request de entrega.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!webhookUrl.publicHttps, {
      code: 'WEBHOOK_PUBLIC_URL_INVALID',
      severity: 'critical',
      message:
        webhookUrl.error ??
        'ASAAS_WEBHOOK_PUBLIC_BASE_URL ou NEXT_PUBLIC_APP_URL precisa apontar para uma URL pública HTTPS.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!credentials?.apiKey, {
      code: 'SUBACCOUNT_CREDENTIALS_MISSING',
      severity: 'critical',
      message: 'A API key da subconta não está disponível para validar ou reconciliar o webhook.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!localAccount?.asaasAccountId, {
      code: 'ASAAS_ACCOUNT_NOT_CONNECTED',
      severity: 'critical',
      message: 'A conta financeira ainda não está conectada a uma subconta do Asaas.',
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(!localAccount?.webhookAuthTokenHash, {
      code: 'WEBHOOK_AUTH_HASH_MISSING',
      severity: 'warning',
      message: 'A hash local do auth token do webhook não está persistida.',
    }),
  );

  for (const warning of processing.warnings) {
    pushRecommendation(recommendations, {
      code: warning.code,
      severity: warning.severity,
      message: warning.message,
    });
  }

  if (driftResult) {
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.remoteMissing, {
        code: 'REMOTE_WEBHOOK_MISSING',
        severity: 'critical',
        message: 'Nenhum webhook remoto ativo compatível foi encontrado na subconta.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.urlMismatch, {
        code: 'REMOTE_WEBHOOK_URL_MISMATCH',
        severity: 'critical',
        message: 'O webhook remoto não aponta para a URL esperada da Alusa.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.disabled, {
        code: 'REMOTE_WEBHOOK_DISABLED',
        severity: 'critical',
        message: 'O webhook remoto está desabilitado no Asaas.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.interrupted, {
        code: 'REMOTE_WEBHOOK_INTERRUPTED',
        severity: 'critical',
        message: 'O webhook remoto está interrompido/pausado no Asaas.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.missingAuthToken, {
        code: 'REMOTE_WEBHOOK_AUTH_TOKEN_MISSING',
        severity: 'critical',
        message: 'O webhook remoto está sem auth token configurado.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.sendTypeMismatch, {
        code: 'REMOTE_WEBHOOK_SEND_TYPE_MISMATCH',
        severity: 'warning',
        message: 'O webhook remoto não está em sendType=SEQUENTIALLY.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.eventsMismatch, {
        code: 'REMOTE_WEBHOOK_EVENTS_MISMATCH',
        severity: 'warning',
        message: 'Os eventos observados pelo webhook remoto divergem do conjunto suportado pela Alusa.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.localHashMismatch, {
        code: 'LOCAL_WEBHOOK_HASH_MISMATCH',
        severity: 'warning',
        message: 'A hash local do webhook diverge da configuração determinística esperada.',
      }),
    );
    pushRecommendation(
      recommendations,
      fromBoolean(driftResult.drift.penalized, {
        code: 'REMOTE_WEBHOOK_PENALIZED',
        severity: 'critical',
        message: 'O webhook remoto possui penalizações acumuladas no Asaas.',
      }),
    );
  }

  pushRecommendation(
    recommendations,
    fromBoolean(queue.errored > 0, {
      code: 'WEBHOOK_QUEUE_ERRORED',
      severity: 'warning',
      message: `Existem ${queue.errored} webhook(s) em ERRO aguardando reprocessamento.`,
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(queue.highRetryBacklog > 0, {
      code: 'WEBHOOK_QUEUE_HIGH_RETRY',
      severity: 'warning',
      message: `Existem ${queue.highRetryBacklog} webhook(s) com alta contagem de tentativas.`,
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(queue.stuckProcessing > 0, {
      code: 'WEBHOOK_QUEUE_STUCK',
      severity: 'critical',
      message: `Existem ${queue.stuckProcessing} webhook(s) travados em PROCESSANDO.`,
    }),
  );
  pushRecommendation(
    recommendations,
    fromBoolean(queue.exhausted > 0, {
      code: 'WEBHOOK_DLQ_PRESENT',
      severity: 'critical',
      message: `Existem ${queue.exhausted} webhook(s) exauridos em DLQ.`,
    }),
  );

  if (retentionAlert) {
    pushRecommendation(recommendations, {
      code: 'WEBHOOK_RETENTION_RISK',
      severity:
        retentionAlert.level === 'CRITICAL' || retentionAlert.level === 'HIGH'
          ? 'critical'
          : 'warning',
      message: retentionAlert.message,
    });
  }

  for (const violation of slo.violations) {
    pushRecommendation(recommendations, {
      code: `WEBHOOK_SLO_${violation.metric.toUpperCase()}`,
      severity: violation.severity,
      message: violation.message,
    });
  }

  if (gapsResult) {
    const chargeGaps = gapsResult.chargesWithMissingFinalStatus.length;
    const subscriptionGaps = gapsResult.subscriptionsWithMissingEvents.length;
    pushRecommendation(
      recommendations,
      fromBoolean(chargeGaps + subscriptionGaps > 0, {
        code: 'WEBHOOK_GAPS_DETECTED',
        severity: 'warning',
        message: `Foram detectados ${chargeGaps} gap(s) em cobranças e ${subscriptionGaps} gap(s) em assinaturas.`,
      }),
    );
  }

  pushRecommendation(
    recommendations,
    fromBoolean(registry.unhandledCritical > 0, {
      code: 'WEBHOOK_REGISTRY_CRITICAL_GAP',
      severity: 'critical',
      message: `Existem ${registry.unhandledCritical} evento(s) críticos do Asaas sem cobertura declarada.`,
    }),
  );

  return {
    contaId: options.contaId,
    status: resolveDiagnosticsStatus(recommendations),
    generatedAt,
    env: {
      featureAsaasEnabled,
      hasWebhookSecret,
      webhookUrl,
      processing,
    },
    local: {
      asaasAccountId: localAccount?.asaasAccountId ?? null,
      financeProfileId: localAccount?.financeProfileId ?? null,
      asaasAccountStatus: localAccount?.status ?? null,
      hasWebhookAuthTokenHash: Boolean(localAccount?.webhookAuthTokenHash),
      hasSubaccountCredentials: Boolean(credentials?.apiKey),
    },
    registry,
    remoteHealth: remoteHealthResult,
    drift: driftResult,
    queue,
    retentionAlert,
    slo,
    gaps: gapsResult,
    recommendations,
  };
}
