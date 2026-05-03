type PerfMetadata = Record<string, unknown>;

function shouldLog(duration: number) {
  return process.env.NODE_ENV === 'development' || duration > 500 || process.env.PERF_LOGS === '1';
}

function sanitizeMetadata(metadata?: PerfMetadata) {
  if (!metadata) return undefined;
  const redactedKeys = new Set(['email', 'cpf', 'password', 'senha', 'token', 'session', 'cookie']);
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
