type JobResultLike = Record<string, unknown>;

const SAFE_EXTRA_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

function numericFields(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};

  return Object.fromEntries(
    Object.entries(result as JobResultLike).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value),
    ),
  );
}

function safeExtraFields(extra: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(extra).filter(
      ([key, value]) =>
        SAFE_EXTRA_KEY.test(key) &&
        (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))),
    ),
  );
}

export function logJobResult(
  jobName: string,
  startedAt: number,
  result: unknown,
  extra: Record<string, unknown> = {},
) {
  console.info(
    JSON.stringify({
      level: 'info',
      type: 'job_completed',
      jobName,
      durationMs: Math.max(0, Date.now() - startedAt),
      ...numericFields(result),
      ...safeExtraFields(extra),
    }),
  );
}

export function logJobFailure(
  jobName: string,
  startedAt: number,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  console.error(
    JSON.stringify({
      level: 'error',
      type: 'job_failed',
      jobName,
      durationMs: Math.max(0, Date.now() - startedAt),
      errorType: error instanceof Error ? error.name : 'unknown_error',
      ...safeExtraFields(extra),
    }),
  );
}
