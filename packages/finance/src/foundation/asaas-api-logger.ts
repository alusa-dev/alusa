/**
 * Asaas API Logger
 *
 * Captura e estrutura logs de chamadas de API ao Asaas,
 * enriquecidos com contexto operacional:
 * - correlationId
 * - circuit breaker state
 * - rate limit info
 * - quota usage
 *
 * Uso:
 *   logAsaasApiCall({ method, endpoint, ... });
 *   getApiCallStats() → snapshot de volume/erros
 */

import { getCorrelationId } from './correlation';
import {
  createStructuredLog,
  normalizeHttpMethod,
  normalizeHttpRoute,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';

// ── Types ────────────────────────────────────────────────────────────────

export interface AsaasApiLogEntry {
  timestamp: string;
  correlationId: string | undefined;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  httpStatus: number | null;
  durationMs: number;
  success: boolean;
  expectedError?: boolean;
  retryCount?: number;
  circuitState?: string;
  rateLimitRemaining?: number;
  quotaRemaining?: number;
  attempts?: number;
  backoffMs?: number;
}

export interface ApiCallStats {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  avgDurationMs: number;
  errorRate: number;
  byMethod: Record<string, number>;
  byEndpoint: Record<string, { count: number; errors: number }>;
  windowStart: Date;
  generatedAt: Date;
}

// ── In-Memory Ring Buffer ────────────────────────────────────────────────

const MAX_ENTRIES = 1000;
const entries: AsaasApiLogEntry[] = [];
let writeIndex = 0;
let totalWritten = 0;

function pushEntry(entry: AsaasApiLogEntry): void {
  if (entries.length < MAX_ENTRIES) {
    entries.push(entry);
  } else {
    entries[writeIndex] = entry;
  }
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  totalWritten++;
}

// ── Public API ───────────────────────────────────────────────────────────

export function logAsaasApiCall(params: {
  method: AsaasApiLogEntry['method'];
  endpoint: string;
  contaId: string;
  accountKey?: string;
  httpStatus: number | null;
  durationMs: number;
  success: boolean;
  expectedError?: boolean;
  error?: string;
  retryCount?: number;
  circuitState?: string;
  rateLimitRemaining?: number;
  quotaRemaining?: number;
  attempts?: number;
  backoffMs?: number;
}): void {
  const entry: AsaasApiLogEntry = {
    timestamp: new Date().toISOString(),
    correlationId: getCorrelationId(),
    method: params.method,
    endpoint: normalizeEndpoint(params.endpoint),
    httpStatus: params.httpStatus,
    durationMs: Number.isFinite(params.durationMs) ? Math.max(0, params.durationMs) : 0,
    success: params.success,
    ...(params.expectedError !== undefined ? { expectedError: params.expectedError } : {}),
    ...(params.retryCount !== undefined ? { retryCount: params.retryCount } : {}),
    ...(params.circuitState ? { circuitState: params.circuitState } : {}),
    ...(params.rateLimitRemaining !== undefined ? { rateLimitRemaining: params.rateLimitRemaining } : {}),
    ...(params.quotaRemaining !== undefined ? { quotaRemaining: params.quotaRemaining } : {}),
    ...(params.attempts !== undefined ? { attempts: params.attempts } : {}),
    ...(params.backoffMs !== undefined ? { backoffMs: params.backoffMs } : {}),
  };

  pushEntry(entry);

  const route = normalizeHttpRoute(entry.endpoint);
  const dimensions = normalizeMetricDimensions({
    provider: 'asaas',
    'http.request.method': normalizeHttpMethod(entry.method),
    'http.route': route,
    'http.response.status_class': entry.httpStatus === null ? 'unknown' : `${Math.floor(entry.httpStatus / 100)}xx`,
    result: entry.success ? 'success' : 'error',
  });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'finance.asaas.api.calls',
    value: 1,
    dimensions,
  });
  void sharedTelemetry.recordMetric({
    kind: 'distribution',
    name: 'finance.asaas.api.duration',
    value: entry.durationMs,
    unit: 'millisecond',
    dimensions,
  });

  // Keep routine successful API calls in aggregated metrics. Stdout/Sentry logs
  // are reserved for errors and slow calls and never contain tenant/account IDs.
  if (!entry.success || entry.durationMs >= 1_000) {
    try {
      const log = createStructuredLog({
        severity: entry.success ? 'warn' : 'error',
        'service.name': 'alusa-finance',
        'event.name': entry.success ? 'finance.asaas.api.slow' : 'finance.asaas.api.failed',
        correlationId: entry.correlationId,
        'http.request.method': normalizeHttpMethod(entry.method),
        'http.route': route,
        'http.response.status_code': entry.httpStatus ?? undefined,
        duration_ms: entry.durationMs,
        attributes: { provider: 'asaas', result: entry.success ? 'success' : 'error' },
        allowedAttributes: ['provider', 'result'],
      });
      (entry.success ? console.warn : console.error)(JSON.stringify(log));
      void sharedTelemetry.publishLog(log);
    } catch {
      // Observability must not affect an integration request.
    }
  }
}

/**
 * Retorna snapshot estatístico das chamadas recentes no ring buffer.
 */
export function getApiCallStats(windowMinutes = 60): ApiCallStats {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);

  const relevant = entries.filter(
    (e) => new Date(e.timestamp) >= windowStart,
  );

  const byMethod: Record<string, number> = {};
  const byEndpoint: Record<string, { count: number; errors: number }> = {};
  let totalDuration = 0;
  let errorCount = 0;

  for (const e of relevant) {
    byMethod[e.method] = (byMethod[e.method] ?? 0) + 1;

    const epKey = normalizeEndpoint(e.endpoint);
    if (!byEndpoint[epKey]) {
      byEndpoint[epKey] = { count: 0, errors: 0 };
    }
    byEndpoint[epKey].count++;
    if (!e.success) byEndpoint[epKey].errors++;

    totalDuration += e.durationMs;
    if (!e.success) errorCount++;
  }

  return {
    totalCalls: relevant.length,
    successCalls: relevant.length - errorCount,
    errorCalls: errorCount,
    avgDurationMs: relevant.length > 0 ? Math.round(totalDuration / relevant.length) : 0,
    errorRate: relevant.length > 0 ? errorCount / relevant.length : 0,
    byMethod,
    byEndpoint,
    windowStart,
    generatedAt: now,
  };
}

/**
 * Retorna as últimas N entradas de log (mais recentes primeiro).
 */
export function getRecentApiCalls(limit = 50): AsaasApiLogEntry[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return sorted.slice(0, limit);
}

/** Reseta buffer (para testes). */
export function resetApiCallStats(): void {
  entries.length = 0;
  writeIndex = 0;
  totalWritten = 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Normaliza endpoint removendo IDs para agrupamento. */
function normalizeEndpoint(endpoint: string): string {
  let pathname = endpoint.split(/[?#]/, 1)[0] || '/';
  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // API clients normally provide path-only values; keep relative paths.
  }
  return pathname
    .replace(/\/[a-f0-9-]{36}/gi, '/:id')
    .replace(/\/(pay|sub|cus|trn|inv|ins)_[a-zA-Z0-9_-]+/g, '/:id')
    .replace(/\/\d+/g, '/:n');
}
