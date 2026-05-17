type PerfMetadata = Record<string, unknown>;

function shouldLog(duration: number) {
  return process.env.NODE_ENV === 'development' || duration > 500 || process.env.PERF_LOGS === '1';
}

function sanitizeMetadata(metadata?: PerfMetadata) {
  if (!metadata) return undefined;
  const redactedKeys = new Set([
    'authorization',
    'cookie',
    'cpf',
    'email',
    'password',
    'senha',
    'session',
    'token',
    'access_token',
    'api_key',
  ]);
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      redactedKeys.has(key.toLowerCase()) ? '[redacted]' : value,
    ]),
  );
}

export function logPerfMetric(
  scope: string,
  operation: string,
  duration: number,
  metadata?: PerfMetadata,
) {
  if (!shouldLog(duration)) return;

  const safeMetadata = sanitizeMetadata(metadata);
  const metaStr = safeMetadata ? ` | ${JSON.stringify(safeMetadata)}` : '';
  const level = duration > 2000 ? 'critical' : duration > 500 ? 'slow' : 'ok';
  console.log(`[PERF] [${level}] [${scope}] ${operation}: ${duration}ms${metaStr}`);
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
    timer.end(operation, { status: 'error', error: String(error), ...metadata });
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
  logPerfMetric(metadata.route, `${metadata.method} route`, metadata.durationMs, {
    contaId: metadata.contaId,
    dbDurationMs: metadata.dbDurationMs,
    asaasDurationMs: metadata.asaasDurationMs,
    cacheState: metadata.cacheState,
    vercelRegion: getVercelRegion(),
    statusCode: metadata.statusCode,
  });
}
