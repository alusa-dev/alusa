/**
 * Webhook Observability Service
 *
 * Responsável por:
 * - Logs estruturados de processamento de webhooks
 * - Métricas de eventos handled/unhandled por categoria
 * - Alertas para eventos críticos sem handler
 *
 * Princípios:
 * - Não altera roteamento/lógica de handlers
 * - Fail-safe: falha de log não impede processamento
 * - Backward compatible: funciona mesmo sem stack de métricas
 */

import {
  ASAAS_EVENT_REGISTRY,
  getEventDefinition,
  getRegistryStats,
  getCriticalEvents,
  isHandledEvent,
  type EventCategory,
  type EventImpactLevel,
} from './asaas-event-registry';
import { getCorrelationId } from '../foundation/correlation';
import {
  createStructuredLog,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';

type WebhookAlertEventName =
  | 'finance.webhook.processing.failed'
  | 'finance.webhook.event.unhandled_critical'
  | 'finance.webhook.event.unknown'
  | 'finance.webhook.auth.token_rejected'
  | 'finance.webhook.queue.lag_alert';

const WEBHOOK_ALERT_ATTRIBUTES = [
  'event.category',
  'webhook.result',
  'webhook.critical',
  'webhook.source',
  'alert.level',
  'alert.count',
  'security.signal',
  'queue.lag_seconds',
  'queue.backlog',
] as const;

function emitWebhookAlertLog(params: {
  severity: 'warn' | 'error';
  eventName: WebhookAlertEventName;
  attributes?: Record<string, string | number | boolean>;
}): void {
  try {
    const log = createStructuredLog({
      severity: params.severity,
      'service.name': 'alusa-finance',
      'event.name': params.eventName,
      attributes: params.attributes,
      allowedAttributes: WEBHOOK_ALERT_ATTRIBUTES,
    });
    (params.severity === 'error' ? console.error : console.warn)(JSON.stringify(log));
    void sharedTelemetry.publishLog(log);
  } catch {
    // Falhas na telemetria nunca interrompem o fluxo financeiro.
  }
}

const ALERT_LOG_INTERVAL_MS = 60_000;
const lastAlertLogAt = new Map<WebhookAlertEventName, number>();

function shouldEmitAlertLog(eventName: WebhookAlertEventName): boolean {
  const now = Date.now();
  const lastEmittedAt = lastAlertLogAt.get(eventName) ?? 0;
  if (now - lastEmittedAt < ALERT_LOG_INTERVAL_MS) return false;
  lastAlertLogAt.set(eventName, now);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface WebhookLogEntry {
  timestamp: string;
  eventName: string;
  eventId: string | null;
  category: EventCategory | 'UNKNOWN';
  handled: boolean;
  critical: boolean;
  impactLevel: EventImpactLevel | 'unknown';
  result: 'SUCCESS' | 'ERROR' | 'IDEMPOTENT' | 'SKIPPED';
  durationMs: number;
  contaId: string;
  error?: string;
  source?: 'WEBHOOK' | 'REPLAY' | 'REPROCESS';
  retry?: boolean;
  correlationId?: string;
}

export interface WebhookMetrics {
  totalEvents: number;
  handledEvents: number;
  unhandledEvents: number;
  criticalEvents: number;
  unhandledCritical: number;
  byCategory: Record<string, CategoryMetrics>;
  healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  lastUpdated: string;
}

export interface CategoryMetrics {
  total: number;
  handled: number;
  unhandled: number;
  percentHandled: number;
  critical: number;
  unhandledCritical: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emite log estruturado para processamento de webhook
 * Fail-safe: erros de log são capturados silenciosamente
 */
export function logWebhookProcessing(entry: WebhookLogEntry): void {
  try {
    const result = entry.result.toLowerCase();
    const dimensions = normalizeMetricDimensions({
      provider: 'asaas',
      result,
      'operation.name': entry.category.toLowerCase(),
    });
    void sharedTelemetry.recordMetric({
      kind: 'counter',
      name: 'finance.webhook.processed',
      value: 1,
      dimensions,
    });
    if (entry.retry) {
      void sharedTelemetry.recordMetric({
        kind: 'counter',
        name: 'finance.webhook.retries',
        value: 1,
        dimensions,
      });
    }
    if (Number.isFinite(entry.durationMs) && entry.durationMs >= 0) {
      void sharedTelemetry.recordMetric({
        kind: 'distribution',
        name: 'finance.webhook.duration',
        value: entry.durationMs,
        unit: 'millisecond',
        dimensions,
      });
    }

    // Successful per-event records create avoidable log volume. Keep full counts
    // in aggregated metrics and emit structured logs only for failed processing.
    if (entry.result !== 'ERROR') return;
    const log = createStructuredLog({
      severity: 'error',
      'service.name': 'alusa-finance',
      'event.name': 'finance.webhook.processing.failed',
      correlationId: entry.correlationId,
      duration_ms: Number.isFinite(entry.durationMs) ? Math.max(0, entry.durationMs) : undefined,
      attributes: {
        'event.category': entry.category,
        'webhook.result': result,
        'webhook.critical': entry.critical,
        'webhook.source': entry.source ?? 'WEBHOOK',
      },
      allowedAttributes: ['event.category', 'webhook.result', 'webhook.critical', 'webhook.source'],
    });
    console.error(JSON.stringify(log));
    void sharedTelemetry.publishLog(log);
  } catch {
    // Fail-safe: nunca bloquear processamento por erro de log
  }
}

/**
 * Cria entrada de log a partir do contexto de processamento
 */
export function createWebhookLogEntry(params: {
  event: string;
  eventId: string | null;
  contaId: string;
  result: WebhookLogEntry['result'];
  durationMs: number;
  error?: string;
  source?: WebhookLogEntry['source'];
  retry?: boolean;
}): WebhookLogEntry {
  const definition = getEventDefinition(params.event);

  return {
    timestamp: new Date().toISOString(),
    eventName: params.event,
    eventId: params.eventId,
    category: definition?.category ?? 'UNKNOWN',
    handled: definition?.handled ?? false,
    critical: definition?.impactLevel === 'critical',
    impactLevel: definition?.impactLevel ?? 'unknown',
    result: params.result,
    durationMs: params.durationMs,
    contaId: params.contaId,
    error: params.error,
    source: params.source ?? 'WEBHOOK',
    retry: params.retry,
    correlationId: getCorrelationId(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// METRICS CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula métricas do registry (estático)
 * Útil para validação em build/CI
 */
export function calculateRegistryMetrics(): WebhookMetrics {
  const stats = getRegistryStats();
  const criticalEvents = getCriticalEvents();
  const unhandledCritical = criticalEvents.filter((e) => !isHandledEvent(e));

  const byCategory: Record<string, CategoryMetrics> = {};

  for (const [, def] of Object.entries(ASAAS_EVENT_REGISTRY)) {
    const cat = def.category;
    if (!byCategory[cat]) {
      byCategory[cat] = {
        total: 0,
        handled: 0,
        unhandled: 0,
        percentHandled: 0,
        critical: 0,
        unhandledCritical: 0,
      };
    }

    byCategory[cat].total += 1;
    if (def.handled) {
      byCategory[cat].handled += 1;
    } else {
      byCategory[cat].unhandled += 1;
    }
    if (def.impactLevel === 'critical') {
      byCategory[cat].critical += 1;
      if (!def.handled) {
        byCategory[cat].unhandledCritical += 1;
      }
    }
  }

  // Calcular percentuais
  for (const cat of Object.keys(byCategory)) {
    const m = byCategory[cat];
    m.percentHandled = m.total > 0 ? Math.round((m.handled / m.total) * 100) : 0;
  }

  // Determinar health status
  let healthStatus: WebhookMetrics['healthStatus'] = 'HEALTHY';
  if (unhandledCritical.length > 0) {
    healthStatus = 'CRITICAL';
  } else if (stats.unhandled > stats.handled) {
    healthStatus = 'WARNING';
  }

  return {
    totalEvents: stats.total,
    handledEvents: stats.handled,
    unhandledEvents: stats.unhandled,
    criticalEvents: stats.critical,
    unhandledCritical: unhandledCritical.length,
    byCategory,
    healthStatus,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Valida que todos os eventos críticos têm handler
 * Retorna lista de violações (vazio = OK)
 */
export function validateCriticalEventsCoverage(): string[] {
  const critical = getCriticalEvents();
  return critical.filter((e) => !isHandledEvent(e));
}

/**
 * Assertion para uso em testes/CI
 * Lança erro se houver evento crítico sem handler
 */
export function assertCriticalEventsCovered(): void {
  const violations = validateCriticalEventsCoverage();
  if (violations.length > 0) {
    throw new Error(
      `CRITICAL: ${violations.length} evento(s) crítico(s) sem handler: ${violations.join(', ')}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY METRICS REPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gera relatório de % unhandled por categoria
 * Formato amigável para logs/dashboards
 */
export function generateUnhandledReport(): {
  summary: string;
  categories: Array<{
    category: string;
    total: number;
    unhandled: number;
    percentUnhandled: number;
    hasCriticalUnhandled: boolean;
  }>;
} {
  const metrics = calculateRegistryMetrics();
  const categories: Array<{
    category: string;
    total: number;
    unhandled: number;
    percentUnhandled: number;
    hasCriticalUnhandled: boolean;
  }> = [];

  for (const [category, m] of Object.entries(metrics.byCategory)) {
    categories.push({
      category,
      total: m.total,
      unhandled: m.unhandled,
      percentUnhandled: m.total > 0 ? Math.round((m.unhandled / m.total) * 100) : 0,
      hasCriticalUnhandled: m.unhandledCritical > 0,
    });
  }

  // Ordenar por % unhandled (maior primeiro)
  categories.sort((a, b) => b.percentUnhandled - a.percentUnhandled);

  const summary = [
    `Total: ${metrics.totalEvents} eventos`,
    `Handled: ${metrics.handledEvents} (${Math.round((metrics.handledEvents / metrics.totalEvents) * 100)}%)`,
    `Unhandled: ${metrics.unhandledEvents} (${Math.round((metrics.unhandledEvents / metrics.totalEvents) * 100)}%)`,
    `Critical sem handler: ${metrics.unhandledCritical}`,
    `Health: ${metrics.healthStatus}`,
  ].join(' | ');

  return { summary, categories };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNTIME ALERTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emite alerta se evento crítico for recebido sem handler
 * Chamado durante processamento de webhook
 */
export function alertIfUnhandledCritical(event: string): void {
  const definition = getEventDefinition(event);

  if (definition?.impactLevel === 'critical' && !definition.handled) {
    void sharedTelemetry.recordMetric({
      kind: 'counter',
      name: 'finance.webhook.unhandled_critical_events',
      value: 1,
      dimensions: normalizeMetricDimensions({ provider: 'asaas' }),
    });
    if (shouldEmitAlertLog('finance.webhook.event.unhandled_critical')) {
      emitWebhookAlertLog({
        severity: 'error',
        eventName: 'finance.webhook.event.unhandled_critical',
        attributes: { 'event.category': definition.category },
      });
    }
  }
}

/**
 * Emite alerta se evento desconhecido for recebido
 */
export function alertIfUnknownEvent(event: string): void {
  const definition = getEventDefinition(event);

  if (!definition) {
    void sharedTelemetry.recordMetric({
      kind: 'counter',
      name: 'finance.webhook.unknown_events',
      value: 1,
      dimensions: normalizeMetricDimensions({ provider: 'asaas' }),
    });
    if (shouldEmitAlertLog('finance.webhook.event.unknown')) {
      emitWebhookAlertLog({
        severity: 'warn',
        eventName: 'finance.webhook.event.unknown',
        attributes: { 'event.category': 'unknown' },
      });
    }
  }
}

/**
 * Emite alerta estruturado quando token de webhook é rejeitado.
 * Possível indicador de misconfiguration ou tentativa de ataque.
 */
export function alertTokenRejected(params: {
  tokenHashPrefix: string;
  event: string;
  eventId: string | null;
}): void {
  // Inputs remain in the function signature for existing callers, but are
  // deliberately excluded from telemetry because they may identify a secret
  // or a single provider delivery.
  void params;
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'finance.webhook.auth.token_rejected',
    value: 1,
    dimensions: normalizeMetricDimensions({ provider: 'asaas' }),
  });

  if (shouldEmitAlertLog('finance.webhook.auth.token_rejected')) {
    emitWebhookAlertLog({
      severity: 'warn',
      eventName: 'finance.webhook.auth.token_rejected',
      attributes: { 'security.signal': 'webhook_token_rejected' },
    });
  }
}

/**
 * Emite alerta quando lag da fila de webhook excede threshold.
 */
export function alertQueueLagCritical(params: {
  level: string;
  lagSeconds: number;
  backlog: number;
  contaId: string;
  message: string;
}): void {
  const severity = params.level === 'CRITICAL' || params.level === 'HIGH' ? 'error' : 'warn';
  const alertLevel = ['CRITICAL', 'HIGH', 'WARNING', 'MEDIUM'].includes(params.level.toUpperCase())
    ? params.level.toLowerCase()
    : 'unknown';
  const attributes: Record<string, string | number | boolean> = { 'alert.level': alertLevel };
  if (Number.isFinite(params.lagSeconds) && params.lagSeconds >= 0) {
    attributes['queue.lag_seconds'] = params.lagSeconds;
  }
  if (Number.isFinite(params.backlog) && params.backlog >= 0) {
    attributes['queue.backlog'] = params.backlog;
  }

  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'finance.webhook.queue.lag_alerts',
    value: 1,
    dimensions: normalizeMetricDimensions({ provider: 'asaas', result: alertLevel }),
  });
  if (shouldEmitAlertLog('finance.webhook.queue.lag_alert')) {
    emitWebhookAlertLog({
      severity,
      eventName: 'finance.webhook.queue.lag_alert',
      attributes,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SLO EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

export interface WebhookSLOThresholds {
  /** Lag máximo aceitável em segundos (default: 300 = 5min) */
  maxLagSeconds: number;
  /** Backlog máximo aceitável (default: 500) */
  maxBacklog: number;
  /** Taxa máxima de erro aceitável (0-1, default: 0.05 = 5%) */
  maxErrorRate: number;
  /** Máximo de webhooks exauridos/DLQ aceitável (default: 10) */
  maxExhausted: number;
}

export interface WebhookSLOResult {
  ok: boolean;
  violations: WebhookSLOViolation[];
  thresholds: WebhookSLOThresholds;
  evaluatedAt: string;
}

export interface WebhookSLOViolation {
  metric: string;
  threshold: number;
  actual: number;
  severity: 'warning' | 'critical';
  message: string;
}

// These legacy values support diagnostic read models only. They are not a
// calibrated production alert policy; external alerts require a baseline.
const DEFAULT_DIAGNOSTIC_THRESHOLDS: WebhookSLOThresholds = {
  maxLagSeconds: 300,
  maxBacklog: 500,
  maxErrorRate: 0.05,
  maxExhausted: 10,
};

/**
 * Avalia SLOs com base em métricas de fila.
 * Retorna violações encontradas (vazio = SLOs atendidos).
 */
export function evaluateWebhookSLOs(
  metrics: {
    lagSeconds: number | null;
    backlog: number;
    errored: number;
    processed: number;
    exhausted?: number;
  },
  thresholds?: Partial<WebhookSLOThresholds>,
): WebhookSLOResult {
  const t = { ...DEFAULT_DIAGNOSTIC_THRESHOLDS, ...thresholds };
  const violations: WebhookSLOViolation[] = [];

  // Lag SLO
  if (metrics.lagSeconds !== null && metrics.lagSeconds > t.maxLagSeconds) {
    violations.push({
      metric: 'lag_seconds',
      threshold: t.maxLagSeconds,
      actual: metrics.lagSeconds,
      severity: metrics.lagSeconds > t.maxLagSeconds * 3 ? 'critical' : 'warning',
      message: `Queue lag ${metrics.lagSeconds}s exceeds SLO of ${t.maxLagSeconds}s`,
    });
  }

  // Backlog SLO
  if (metrics.backlog > t.maxBacklog) {
    violations.push({
      metric: 'backlog',
      threshold: t.maxBacklog,
      actual: metrics.backlog,
      severity: metrics.backlog > t.maxBacklog * 2 ? 'critical' : 'warning',
      message: `Queue backlog ${metrics.backlog} exceeds SLO of ${t.maxBacklog}`,
    });
  }

  // Error rate SLO
  const total = metrics.errored + metrics.processed;
  if (total > 0) {
    const errorRate = metrics.errored / total;
    if (errorRate > t.maxErrorRate) {
      violations.push({
        metric: 'error_rate',
        threshold: t.maxErrorRate,
        actual: Number(errorRate.toFixed(4)),
        severity: errorRate > t.maxErrorRate * 2 ? 'critical' : 'warning',
        message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds SLO of ${(t.maxErrorRate * 100).toFixed(1)}%`,
      });
    }
  }

  // Exhausted/DLQ SLO
  if (typeof metrics.exhausted === 'number' && metrics.exhausted > t.maxExhausted) {
    violations.push({
      metric: 'exhausted_dlq',
      threshold: t.maxExhausted,
      actual: metrics.exhausted,
      severity: 'critical',
      message: `${metrics.exhausted} exhausted webhooks exceeds SLO of ${t.maxExhausted}`,
    });
  }

  const result: WebhookSLOResult = {
    ok: violations.length === 0,
    violations,
    thresholds: t,
    evaluatedAt: new Date().toISOString(),
  };

  return result;
}
