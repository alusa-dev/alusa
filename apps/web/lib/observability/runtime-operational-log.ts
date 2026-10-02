import { createStructuredLog, sharedTelemetry } from '@alusa/observability';

type EventName =
  | 'api.error.reported'
  | 'auth.password_change.audit_failed'
  | 'auth.session.lookup_failed'
  | 'cache.primary.fallback'
  | 'dashboard.prefetch.failed'
  | 'privacy.sensitive_access.audit_failed'
  | 'security.rate_limit.unavailable'
  | 'security.http_method.rejected'
  | 'api.mobile.events.request.failed'
  | 'api.avatar.cleanup.failed';

type Category = 'get' | 'set' | 'delete' | 'lock' | 'unavailable' | 'invalid_method' | 'cleanup_new' | 'cleanup_previous';

const recent = new Map<string, { count: number; emittedAt: number }>();
const ALLOWED_ERROR_TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ZodError',
  'PrismaClientKnownRequestError',
  'PrismaClientValidationError',
  'PasswordChangeOtpError',
  'AvatarServiceError',
  'EventsError',
]);

export function logRuntimeOperationalEvent(params: {
  eventName: EventName;
  error?: unknown;
  category?: Category;
  count?: number;
  severity?: 'warn' | 'error';
}): void {
  const key = `${params.eventName}:${params.category ?? 'none'}`;
  const now = Date.now();
  const previous = recent.get(key);
  const count = (previous?.count ?? 0) + 1;
  if (previous && now - previous.emittedAt < 60_000) {
    recent.set(key, { count, emittedAt: previous.emittedAt });
    return;
  }
  recent.set(key, { count: 0, emittedAt: now });

  const errorType = params.error instanceof Error
    ? ALLOWED_ERROR_TYPES.has(params.error.name) ? params.error.name : 'Error'
    : undefined;
  const log = createStructuredLog({
    severity: params.severity ?? 'error',
    'service.name': 'alusa-web',
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    'http.request.method': 'UNKNOWN',
    'http.route': '/internal/operational-event',
    'error.type': errorType,
    attributes: {
      ...(params.category ? { category: params.category } : {}),
      ...(Number.isSafeInteger(params.count) && (params.count ?? -1) >= 0 ? { count: params.count } : {}),
      ...(previous ? { suppressedCount: count } : {}),
    },
    allowedAttributes: ['category', 'count', 'suppressedCount'],
  });
  if (log.severity === 'error') console.error(JSON.stringify(log));
  else console.warn(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
