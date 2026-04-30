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

// ── Types ────────────────────────────────────────────────────────────────

export interface AsaasApiLogEntry {
  timestamp: string;
  correlationId: string | undefined;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  contaId: string;
  httpStatus: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  retryCount?: number;
  circuitState?: string;
  rateLimitRemaining?: number;
  quotaRemaining?: number;
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
  httpStatus: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  retryCount?: number;
  circuitState?: string;
  rateLimitRemaining?: number;
  quotaRemaining?: number;
}): void {
  const entry: AsaasApiLogEntry = {
    timestamp: new Date().toISOString(),
    correlationId: getCorrelationId(),
    ...params,
  };

  pushEntry(entry);

  // Log estruturado para stdout (parseable por ferramentas)
  try {
    console.log(JSON.stringify({
      level: params.success ? 'info' : 'error',
      type: 'asaas_api_call',
      ...entry,
    }));
  } catch {
    // fail-safe
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
  return endpoint
    .replace(/\/[a-f0-9-]{36}/gi, '/:id')
    .replace(/\/(pay|sub|cus|trn|inv|ins)_[a-zA-Z0-9]+/g, '/:id')
    .replace(/\/\d+/g, '/:n');
}
