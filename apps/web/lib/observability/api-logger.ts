type ApiLogLevel = 'info' | 'warn' | 'error';

type ApiLogFields = {
  route: string;
  requestId: string;
  method: string;
  status?: number;
  errorCode?: string;
  tenantId?: string;
  resourceId?: string;
  durationMs?: number;
  [key: string]: unknown;
};

function write(level: ApiLogLevel, fields: ApiLogFields) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: 'alusa-web',
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA,
    level,
    ...fields,
  };

  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
}

export function getRequestId(request: Request): string {
  return request.headers.get('x-request-id')?.trim()
    || request.headers.get('x-vercel-id')?.trim()
    || crypto.randomUUID();
}

export function logApiResponse(params: ApiLogFields & { startedAt: number }) {
  const { startedAt, ...fields } = params;
  const status = fields.status ?? 200;
  write(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
    ...fields,
    status,
    durationMs: Date.now() - startedAt,
    event: status >= 400 ? 'api.request.rejected' : 'api.request.completed',
  });
}

export function logApiError(params: ApiLogFields & { startedAt: number; error?: unknown }) {
  const { startedAt, error, ...fields } = params;
  const errorName = error instanceof Error ? error.name : undefined;
  write('error', {
    ...fields,
    event: 'api.request.failed',
    durationMs: Date.now() - startedAt,
    errorName,
  });
}
