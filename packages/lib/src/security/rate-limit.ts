type Bucket = { count: number; expiresAt: number };
export type RateLimitSource = 'redis' | 'memory' | 'bypassed' | 'unavailable';
export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  source?: RateLimitSource;
  degraded?: boolean;
};

const globalState = globalThis as unknown as { __alusaRateLimit?: Map<string, Bucket> };
const store = globalState.__alusaRateLimit ?? new Map<string, Bucket>();
globalState.__alusaRateLimit = store;

function isRateLimitBypassedInDev() {
  return process.env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLE_IN_DEV !== 'false';
}

function shouldTrustProxyHeaders() {
  // Proxy headers are only authoritative when the deployment explicitly opts
  // in. Authenticated tenant/user keys remain available even when this is off.
  return process.env.TRUST_PROXY_HEADERS === 'true';
}

function localRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    const expiresAt = now + windowMs;
    store.set(key, { count: 1, expiresAt });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: expiresAt, source: 'memory', degraded: true };
  }
  if (bucket.count >= limit) return { ok: false, remaining: 0, resetAt: bucket.expiresAt, source: 'memory', degraded: true };
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.expiresAt, source: 'memory', degraded: true };
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.REDIS_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.REDIS_TOKEN?.trim();
  if (!url?.startsWith('http') || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisCommand<T>(command: unknown[]): Promise<T> {
  const config = redisConfig();
  if (!config) throw new Error('Redis REST rate limit is not configured');
  const timeoutMs = Math.min(Math.max(Number(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS ?? 250), 50), 2_000);
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Redis REST rate limit failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result as T;
}

function redisKey(key: string) {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local';
  return `alusa:${env}:rate-limit:${key.trim().replace(/[^a-zA-Z0-9._:-]/g, '-')}`;
}

async function distributedRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  // One atomic EVAL avoids the race between INCR and PEXPIRE and reduces the
  // limiter from three network round trips to one.
  const script = [
    'local count = redis.call("INCR", KEYS[1])',
    'if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[2]) end',
    'local ttl = redis.call("PTTL", KEYS[1])',
    'return {count, ttl}',
  ].join('\n');
  const result = await redisCommand<unknown>(['EVAL', script, 1, redisKey(key), String(limit), String(windowMs)]);
  const values = Array.isArray(result) ? result : [];
  const count = Number(values[0] ?? 0);
  const ttlMs = Number(values[1] ?? windowMs);
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + Math.max(ttlMs, 0),
    source: 'redis',
    degraded: false,
  };
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now(), source: 'bypassed', degraded: false };
  return localRateLimit(key, limit, windowMs);
}

export async function rateLimitAsync(key: string, limit: number, windowMs: number) {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now(), source: 'bypassed' as const, degraded: false };
  if (!redisConfig()) return rateLimit(key, limit, windowMs);
  try { return await distributedRateLimit(key, limit, windowMs); }
  catch (error) {
    console.warn('[rate-limit][redis-fallback]', { error: error instanceof Error ? error.message : String(error) });
    return { ...rateLimit(key, limit, windowMs), degraded: true };
  }
}

/**
 * Limiter for public security-sensitive endpoints.
 * Production must fail closed when the shared store is unavailable; a
 * process-local Map is not sufficient across serverless replicas.
 */
export async function strictRateLimitAsync(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now(), source: 'bypassed', degraded: false };
  if (!redisConfig()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[rate-limit][strict-unavailable]', { reason: 'redis_not_configured' });
      return { ok: false, remaining: 0, resetAt: Date.now() + windowMs, source: 'unavailable', degraded: true };
    }
    return rateLimit(key, limit, windowMs);
  }
  try {
    return await distributedRateLimit(key, limit, windowMs);
  } catch (error) {
    console.error('[rate-limit][strict-unavailable]', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, remaining: 0, resetAt: Date.now() + windowMs, source: 'unavailable', degraded: true };
  }
}

export async function authRateLimitAsync(key: string, limit: number, windowMs: number) {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now(), source: 'bypassed' as const, degraded: false };
  if (!redisConfig()) {
    if (process.env.NODE_ENV === 'production') { console.error('[rate-limit][auth-unavailable]', { reason: 'redis_not_configured' }); return { ok: false, remaining: 0, resetAt: Date.now() + windowMs, source: 'unavailable' as const, degraded: true }; }
    return rateLimit(key, limit, windowMs);
  }
  try { return await distributedRateLimit(key, limit, windowMs); }
  catch (error) { console.error('[rate-limit][auth-unavailable]', { error: error instanceof Error ? error.message : String(error) }); return { ok: false, remaining: 0, resetAt: Date.now() + windowMs, source: 'unavailable' as const, degraded: true }; }
}

export async function rateLimitSubject(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ipFromRequest(req: Request) {
  if (shouldTrustProxyHeaders()) {
    for (const header of ['x-real-ip', 'cf-connecting-ip', 'fly-client-ip']) { const value = req.headers.get(header)?.trim(); if (value) return value; }
    if (process.env.TRUST_PROXY_HEADERS === 'true') { const forwarded = req.headers.get('x-forwarded-for'); if (forwarded) return forwarded.split(',')[0].trim(); }
  }
  return `ua:${req.headers.get('user-agent') || 'ua'}|al:${req.headers.get('accept-language') || 'al'}`;
}
