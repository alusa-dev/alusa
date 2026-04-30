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
    const logData = {
      level: entry.result === 'ERROR' ? 'error' : 'info',
      type: 'webhook_processing',
      ...entry,
    };

    // Usar console.log com JSON para facilitar parsing por ferramentas
    console.log(JSON.stringify(logData));
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
    try {
      console.error(
        JSON.stringify({
          level: 'critical',
          type: 'unhandled_critical_event',
          event,
          category: definition.category,
          message: `Evento crítico ${event} recebido mas não possui handler!`,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // Fail-safe
    }
  }
}

/**
 * Emite alerta se evento desconhecido for recebido
 */
export function alertIfUnknownEvent(event: string): void {
  const definition = getEventDefinition(event);

  if (!definition) {
    try {
      console.warn(
        JSON.stringify({
          level: 'warning',
          type: 'unknown_event',
          event,
          message: `Evento desconhecido ${event} recebido. Considere adicionar ao registry.`,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // Fail-safe
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
  try {
    console.error(
      JSON.stringify({
        level: 'warning',
        type: 'webhook_token_rejected',
        event: params.event,
        eventId: params.eventId,
        tokenHashPrefix: params.tokenHashPrefix,
        message: 'Webhook recebido com token não reconhecido.',
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Fail-safe
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
  try {
    console.error(
      JSON.stringify({
        level: params.level === 'CRITICAL' || params.level === 'HIGH' ? 'error' : 'warning',
        type: 'webhook_queue_lag',
        alertLevel: params.level,
        lagSeconds: params.lagSeconds,
        backlog: params.backlog,
        contaId: params.contaId,
        message: params.message,
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Fail-safe
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

const DEFAULT_SLO_THRESHOLDS: WebhookSLOThresholds = {
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
  const t = { ...DEFAULT_SLO_THRESHOLDS, ...thresholds };
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

  // Emitir alerta se houver violação
  if (violations.length > 0) {
    try {
      const hasCritical = violations.some((v) => v.severity === 'critical');
      console.error(
        JSON.stringify({
          level: hasCritical ? 'error' : 'warning',
          type: 'webhook_slo_violation',
          violations: violations.map((v) => v.message),
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // Fail-safe
    }
  }

  return result;
}
