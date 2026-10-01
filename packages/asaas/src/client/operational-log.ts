import {
  createStructuredLog,
  normalizeHttpMethod,
  normalizeHttpRoute,
  sharedTelemetry,
} from '@alusa/observability';

type AsaasOperationalEventName =
  | 'asaas.http.request.failed'
  | 'asaas.quota.redis_fallback'
  | 'asaas.quota.near_limit'
  | 'asaas.quota.exceeded'
  | 'asaas.circuit.opened';

type ErrorType = 'AsaasHttpError' | 'AsaasQuotaStoreUnavailableError' | 'Error';
const THROTTLED_EVENTS = new Set<AsaasOperationalEventName>([
  'asaas.quota.redis_fallback',
  'asaas.quota.near_limit',
  'asaas.quota.exceeded',
  'asaas.circuit.opened',
]);
const buckets = new Map<AsaasOperationalEventName, { count: number; lastEmittedAt: number }>();
const ASAAS_RESOURCES = new Set([
  'accounts', 'anticipations', 'creditcard', 'customers', 'financialtransactions',
  'fiscalinfo', 'finance', 'installments', 'invoices', 'myaccount', 'payments',
  'pix', 'subscriptions', 'transfers', 'wallets', 'webhooks', 'sandbox',
]);

export function normalizeAsaasRoute(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const version = /^v\d+$/.test(segments[0] ?? '') ? (segments[0] ?? '').toLowerCase() : 'v3';
  const resource = segments[0] === version ? segments[1] : segments[0];
  const safeResource = resource && ASAAS_RESOURCES.has(resource.toLowerCase())
    ? resource.toLowerCase()
    : 'other';
  return normalizeHttpRoute(`/${version}/${safeResource}`);
}

export function logAsaasOperationalEvent(params: {
  eventName: AsaasOperationalEventName;
  severity: 'info' | 'warn' | 'error';
  errorType?: ErrorType;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  category?: 'provider_response' | 'redis_unavailable';
  count?: number;
}): void {
  let count = Number.isSafeInteger(params.count) && (params.count ?? -1) >= 0 ? params.count ?? 1 : 1;
  if (THROTTLED_EVENTS.has(params.eventName)) {
    const now = Date.now();
    const bucket = buckets.get(params.eventName) ?? { count: 0, lastEmittedAt: 0 };
    bucket.count += count;
    buckets.set(params.eventName, bucket);
    if (bucket.lastEmittedAt > 0 && now - bucket.lastEmittedAt < 60_000) return;
    count = bucket.count;
    bucket.count = 0;
    bucket.lastEmittedAt = now;
  }

  const log = createStructuredLog({
    severity: params.severity,
    'service.name': 'alusa-asaas',
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    'http.request.method': params.method ? normalizeHttpMethod(params.method) : undefined,
    'http.route': params.route ? normalizeAsaasRoute(params.route) : undefined,
    'http.response.status_code': params.status,
    duration_ms: params.durationMs,
    'error.type': params.errorType,
    attributes: {
      ...(params.category ? { category: params.category } : {}),
      ...(THROTTLED_EVENTS.has(params.eventName) ? { count } : {}),
    },
    allowedAttributes: ['category', 'count'],
  });

  if (params.severity === 'error') console.error(JSON.stringify(log));
  else if (params.severity === 'warn') console.warn(JSON.stringify(log));
  else console.info(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
