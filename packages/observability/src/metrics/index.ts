export type MetricDimensionValue = string | number | boolean;
export type MetricDimensions = Readonly<Record<string, MetricDimensionValue>>;
const KEY_PATTERN = /^[a-z][a-z0-9_.]{0,62}$/;
const SAFE_VALUE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const FORBIDDEN_KEY = /(?:conta.?id|tenant|user.?id|student|responsible|email|phone|document|customer|payment.?id|charge.?id|request.?id|trace.?id|correlation.?id)/i;
const SAFE_KEYS = new Set(['http.request.method', 'http.route', 'http.response.status_class', 'job.name', 'operation.name', 'result', 'cache.state', 'error.type', 'web_vital.name', 'web_vital.rating', 'provider']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export function normalizeHttpMethod(method: string): string {
  const normalized = method.trim().toUpperCase();
  return HTTP_METHODS.has(normalized) ? normalized.toLowerCase() : 'other';
}

/** Keeps only approved, bounded dimensions; IDs and arbitrary route values never become labels. */
export function normalizeMetricDimensions(input: Record<string, unknown>, allowedKeys: readonly string[] = [...SAFE_KEYS]): Record<string, string> {
  const allow = new Set(allowedKeys);
  const dimensions: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!KEY_PATTERN.test(key) || !allow.has(key) || FORBIDDEN_KEY.test(key)) continue;
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') continue;
    const value = String(rawValue).trim();
    if (key === 'http.route') {
      const route = normalizeHttpRoute(value).toLowerCase();
      const segments = route.split('/').filter(Boolean);
      if (route.length > 160 || segments.length > 8) continue;
      if (segments.some((segment) => segment !== ':id' && !/^[a-z][a-z0-9._~-]{0,39}$/.test(segment))) continue;
      dimensions[key] = route;
      continue;
    }
    if (!(SAFE_VALUE.test(value) || /^\dxx$/i.test(value)) || /[-_]\d{2,}/.test(value) || /^\d{2,}$/.test(value)) continue;
    dimensions[key] = value.toLowerCase();
  }
  return dimensions;
}

export function normalizeHttpRoute(route: string): string {
  const pathname = route.split(/[?#]/, 1)[0] || '/';
  const normalized = pathname.split('/').map((segment) => {
    let decodedSegment = segment;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      // Preserve malformed input as an opaque segment; the heuristics below
      // still collapse recognizable identifiers without throwing.
    }
    if (/^\[\[?\.\.\..+\]\]?$/.test(decodedSegment) || /^\[[^\]]+\]$/.test(decodedSegment)) return ':id';
    if (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[a-z0-9_-]{20,}$/i.test(segment)) return ':id';
    return segment;
  }).join('/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function statusClass(statusCode: number): string {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return 'unknown';
  return `${Math.floor(statusCode / 100)}xx`;
}
