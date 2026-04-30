/**
 * Metrics Exporter
 *
 * Agrega métricas operacionais de todas as camadas de resiliência
 * em um snapshot estruturado exportável (JSON ou Prometheus text).
 *
 * Fontes:
 * - WebhookQueueMetrics (fila, backlog, lag)
 * - CircuitBreaker state
 * - QuotaTracker usage
 * - RateLimitTracker info
 * - API call stats (ring buffer)
 * - WebhookSLO results
 * - ConcurrencyLimiter state
 */

import { globalCircuitBreaker, globalQuotaTracker, globalRateLimitTracker, globalGetLimiter } from '@alusa/asaas';
import { getApiCallStats } from './asaas-api-logger';

// ── Types ────────────────────────────────────────────────────────────────

export interface OperationalMetricsSnapshot {
  generatedAt: string;

  circuitBreaker: {
    circuits: Record<string, { state: string; failures: number; lastFailureAt: number }>;
    totalOpen: number;
  };

  quota: {
    accounts: Record<string, { used: number; remaining: number; percentUsed: number; warning: boolean }>;
    globalLimit: number;
  };

  rateLimitTracker: Record<string, { limit: number | null; remaining: number | null; resetSeconds: number | null }>;

  concurrency: {
    active: number;
    maxConcurrent: number;
    waiting: number;
  };

  apiCalls: {
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
    avgDurationMs: number;
    errorRate: number;
    byMethod: Record<string, number>;
    topEndpoints: Array<{ endpoint: string; count: number; errors: number }>;
  };
}

// ── Snapshot Builder ─────────────────────────────────────────────────────

export function collectOperationalMetrics(windowMinutes = 60): OperationalMetricsSnapshot {
  const cbSnapshots = globalCircuitBreaker.allSnapshots();
  const quotaSnapshots = globalQuotaTracker.allSnapshots();
  const rlSnapshot = globalRateLimitTracker.snapshot();
  const apiStats = getApiCallStats(windowMinutes);

  // Circuit breaker summary
  const circuits: OperationalMetricsSnapshot['circuitBreaker']['circuits'] = {};
  let totalOpen = 0;
  for (const [key, entry] of Object.entries(cbSnapshots)) {
    circuits[key] = { state: entry.state, failures: entry.failures, lastFailureAt: entry.lastFailureAt };
    if (entry.state === 'OPEN') totalOpen++;
  }

  // Quota summary
  const quotaAccounts: OperationalMetricsSnapshot['quota']['accounts'] = {};
  for (const [key, status] of Object.entries(quotaSnapshots)) {
    quotaAccounts[key] = {
      used: status.count,
      remaining: status.remaining,
      percentUsed: status.percentUsed,
      warning: status.warning,
    };
  }

  // Rate limit summary
  const rateLimitData: OperationalMetricsSnapshot['rateLimitTracker'] = {};
  for (const [key, info] of Object.entries(rlSnapshot)) {
    rateLimitData[key] = { limit: info.limit, remaining: info.remaining, resetSeconds: info.resetSeconds };
  }

  // Top endpoints (top 10 by count)
  const topEndpoints = Object.entries(apiStats.byEndpoint)
    .map(([endpoint, data]) => ({ endpoint, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),

    circuitBreaker: { circuits, totalOpen },
    quota: { accounts: quotaAccounts, globalLimit: globalQuotaTracker.limit },
    rateLimitTracker: rateLimitData,

    concurrency: {
      active: globalGetLimiter.currentRunning,
      maxConcurrent: globalGetLimiter.maxConcurrent,
      waiting: globalGetLimiter.queueLength,
    },

    apiCalls: {
      totalCalls: apiStats.totalCalls,
      successCalls: apiStats.successCalls,
      errorCalls: apiStats.errorCalls,
      avgDurationMs: apiStats.avgDurationMs,
      errorRate: apiStats.errorRate,
      byMethod: apiStats.byMethod,
      topEndpoints,
    },
  };
}

// ── Prometheus Text Format ───────────────────────────────────────────────

export function toPrometheusText(metrics: OperationalMetricsSnapshot): string {
  const lines: string[] = [];

  const g = (name: string, help: string, value: number, labels?: Record<string, string>) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr = labels
      ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
      : '';
    lines.push(`${name}${labelStr} ${value}`);
  };

  g('asaas_circuit_breaker_open_total', 'Total open circuits', metrics.circuitBreaker.totalOpen);
  for (const [key, cb] of Object.entries(metrics.circuitBreaker.circuits)) {
    const stateNum = cb.state === 'CLOSED' ? 0 : cb.state === 'OPEN' ? 1 : 2;
    g('asaas_circuit_breaker_state', 'Circuit state (0=closed,1=open,2=half_open)', stateNum, { account: key });
    g('asaas_circuit_breaker_failures', 'Failure count', cb.failures, { account: key });
  }

  g('asaas_quota_limit', 'API quota limit', metrics.quota.globalLimit);
  for (const [key, q] of Object.entries(metrics.quota.accounts)) {
    g('asaas_quota_used', 'Quota used', q.used, { account: key });
    g('asaas_quota_remaining', 'Quota remaining', q.remaining, { account: key });
  }

  g('asaas_concurrency_active', 'Active concurrent requests', metrics.concurrency.active);
  g('asaas_concurrency_max', 'Max concurrent requests', metrics.concurrency.maxConcurrent);
  g('asaas_concurrency_waiting', 'Waiting requests', metrics.concurrency.waiting);
  g('asaas_api_calls_total', 'Total API calls in window', metrics.apiCalls.totalCalls);
  g('asaas_api_calls_errors', 'Error API calls in window', metrics.apiCalls.errorCalls);
  g('asaas_api_calls_avg_duration_ms', 'Average call duration ms', metrics.apiCalls.avgDurationMs);
  g('asaas_api_calls_error_rate', 'Error rate', metrics.apiCalls.errorRate);

  for (const [method, count] of Object.entries(metrics.apiCalls.byMethod)) {
    g('asaas_api_calls_by_method', 'API calls by method', count, { method });
  }

  return lines.join('\n') + '\n';
}
