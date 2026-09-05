type Bucket = { count: number; expiresAt: number };
export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

const globalState = globalThis as unknown as { __alusaRateLimit?: Map<string, Bucket> };
const store = globalState.__alusaRateLimit ?? new Map<string, Bucket>();
globalState.__alusaRateLimit = store;

function isRateLimitBypassedInDev() { return process.env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLE_IN_DEV !== 'false'; }
function shouldTrustProxyHeaders() { return process.env.TRUST_PROXY_HEADERS === 'true' || process.env.VERCEL === '1'; }

function localRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    const expiresAt = now + windowMs;
    store.set(key, { count: 1, expiresAt });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: expiresAt };
  }
  if (bucket.count >= limit) return { ok: false, remaining: 0, resetAt: bucket.expiresAt };
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.expiresAt };
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
  const response = await fetch(config.url, { method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
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
  const count = Number(await redisCommand<number>(['INCR', redisKey(key)]));
  if (count === 1) await redisCommand(['PEXPIRE', redisKey(key), windowMs]);
  const ttlMs = Number(await redisCommand<number>(['PTTL', redisKey(key)]));
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + Math.max(ttlMs, 0) };
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now() };
  return localRateLimit(key, limit, windowMs);
}

export async function rateLimitAsync(key: string, limit: number, windowMs: number) {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now() };
  if (!redisConfig()) return rateLimit(key, limit, windowMs);
  try { return await distributedRateLimit(key, limit, windowMs); }
  catch (error) { console.warn('[rate-limit][redis-fallback]', { key, error: error instanceof Error ? error.message : String(error) }); return rateLimit(key, limit, windowMs); }
}

/**
 * Limiter for public security-sensitive endpoints.
 * Production must fail closed when the shared store is unavailable; a
 * process-local Map is not sufficient across serverless replicas.
 */
export async function strictRateLimitAsync(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now() };
  if (!redisConfig()) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[rate-limit][strict-unavailable]', { reason: 'redis_not_configured' });
      return { ok: false, remaining: 0, resetAt: Date.now() + windowMs };
    }
    return rateLimit(key, limit, windowMs);
  }
  try {
    return await distributedRateLimit(key, limit, windowMs);
  } catch (error) {
    console.error('[rate-limit][strict-unavailable]', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, remaining: 0, resetAt: Date.now() + windowMs };
  }
}

export async function authRateLimitAsync(key: string, limit: number, windowMs: number) {
  if (isRateLimitBypassedInDev()) return { ok: true, remaining: limit, resetAt: Date.now() };
  if (!redisConfig()) {
    if (process.env.NODE_ENV === 'production') { console.error('[rate-limit][auth-unavailable]', { reason: 'redis_not_configured' }); return { ok: false, remaining: 0, resetAt: Date.now() + windowMs }; }
    return rateLimit(key, limit, windowMs);
  }
  try { return await distributedRateLimit(key, limit, windowMs); }
  catch (error) { console.error('[rate-limit][auth-unavailable]', { error: error instanceof Error ? error.message : String(error) }); return { ok: false, remaining: 0, resetAt: Date.now() + windowMs }; }
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
