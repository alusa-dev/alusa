import {
  createStructuredLog,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';
import { shouldSampleMetric } from '@/lib/observability/sampling';

type PerfMetadata = Record<string, unknown>;

const lastLoggedAt = new Map<string, number>();

const SAFE_METADATA = new Set([
  'status', 'cacheState', 'statusCode', 'dbDurationMs', 'asaasDurationMs',
]);

function safeMetadata(metadata?: PerfMetadata) {
  if (!metadata) return {};
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA.has(key)) continue;
    if (key === 'status' && (value === 'success' || value === 'error')) safe[key] = value;
    else if (key === 'cacheState' && ['HIT', 'MISS', 'STALE', 'BYPASS'].includes(String(value))) safe[key] = String(value);
    else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) safe[key] = value;
  }
  return safe;
}

export function logPerfMetric(
  scope: string,
  operation: string,
  duration: number,
  metadata?: PerfMetadata,
) {
  void scope;
  if (!Number.isFinite(duration)) return;
  const level = duration > 2000 ? 'critical' : duration > 500 ? 'slow' : 'ok';
  const safeOperation = /^[a-z][a-z0-9._-]{0,63}$/i.test(operation) && !/[-_]\d{2,}/.test(operation)
    ? operation.toLowerCase()
    : 'operation';
  const dimensions = normalizeMetricDimensions({
    'operation.name': safeOperation,
    result: metadata?.status === 'error' ? 'error' : 'success',
  });

  if (shouldSampleMetric(process.env.OBSERVABILITY_METRIC_SAMPLE_RATE)) {
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.operation.duration',
      value: Math.max(0, duration),
      unit: 'millisecond',
      dimensions,
    });
  }

  if (duration <= 500) return;
  const lastLogged = lastLoggedAt.get(safeOperation);
  if (lastLogged !== undefined && Date.now() - lastLogged < 60_000) return;
  lastLoggedAt.set(safeOperation, Date.now());
  const meta = safeMetadata(metadata);
  const log = createStructuredLog({
    severity: level === 'critical' ? 'error' : level === 'slow' ? 'warn' : 'info',
    'service.name': 'alusa-web',
    'event.name': 'performance.slow_operation',
    duration_ms: Math.max(0, duration),
    attributes: { operation: safeOperation, perfLevel: level, ...meta },
    allowedAttributes: ['operation', 'perfLevel', ...SAFE_METADATA],
  });
  console.warn(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}

export function createPerfTimer(scope: string) {
  const start = Date.now();

  return {
    end: (operation: string, metadata?: PerfMetadata) => {
      const duration = Date.now() - start;
      logPerfMetric(scope, operation, duration, metadata);
      return duration;
    },
  };
}

export async function withPerfTimer<T>(
  scope: string,
  operation: string,
  fn: () => Promise<T>,
  metadata?: PerfMetadata,
): Promise<T> {
  const timer = createPerfTimer(scope);
  try {
    const result = await fn();
    timer.end(operation, { status: 'success', ...metadata });
    return result;
  } catch (error) {
    timer.end(operation, { status: 'error', errorType: error instanceof Error ? error.name : 'unknown_error', ...metadata });
    throw error;
  }
}

export function getVercelRegion() {
  return process.env.VERCEL_REGION ?? process.env.VERCEL_REGION_ID ?? 'local';
}

export function logRoutePerformance(metadata: {
  route: string;
  method: string;
  contaId?: string | null;
  durationMs: number;
  dbDurationMs?: number;
  asaasDurationMs?: number;
  cacheState?: string;
  statusCode: number;
}) {
  logPerfMetric(metadata.route, 'route', metadata.durationMs, {
    route: metadata.route,
    status: metadata.statusCode >= 500 ? 'error' : 'success',
    dbDurationMs: metadata.dbDurationMs,
    asaasDurationMs: metadata.asaasDurationMs,
    cacheState: metadata.cacheState,
    vercelRegion: getVercelRegion(),
    statusCode: metadata.statusCode,
  });
}
