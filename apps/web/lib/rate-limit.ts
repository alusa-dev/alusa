type Bucket = { count: number; expiresAt: number };
type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

const g = globalThis as unknown as { __rateLimit?: Map<string, Bucket> };
if (!g.__rateLimit) g.__rateLimit = new Map();
const store = g.__rateLimit;

function isRateLimitBypassedInDev(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  return process.env.RATE_LIMIT_DISABLE_IN_DEV !== 'false';
}

function shouldTrustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS === 'true' || process.env.NODE_ENV === 'production';
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetAt: number } {
  if (isRateLimitBypassedInDev()) {
    return { ok: true, remaining: limit, resetAt: Date.now() };
  }

  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    const expiresAt = now + windowMs;
    store.set(key, { count: 1, expiresAt });
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: expiresAt };
  }
  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.expiresAt };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.expiresAt };
}

function getRedisRestConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? (
    process.env.REDIS_URL?.startsWith('http') ? process.env.REDIS_URL : undefined
  );
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN;

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisCommand<T>(command: unknown[]): Promise<T> {
  const config = getRedisRestConfig();
  if (!config) throw new Error('Redis REST rate limit is not configured');

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Redis REST rate limit command failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result as T;
}

function buildRedisRateLimitKey(key: string) {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local';
  const normalized = key.trim().replace(/[^a-zA-Z0-9._:-]/g, '-');
  return `alusa:${env}:rate-limit:${normalized}`;
}

export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (isRateLimitBypassedInDev()) {
    return { ok: true, remaining: limit, resetAt: Date.now() };
  }

  if (!getRedisRestConfig()) {
    return rateLimit(key, limit, windowMs);
  }

  try {
    const redisKey = buildRedisRateLimitKey(key);
    const count = Number(await redisCommand<number>(['INCR', redisKey]));
    if (count === 1) {
      await redisCommand(['PEXPIRE', redisKey, windowMs]);
    }

    const ttlMs = Number(await redisCommand<number>(['PTTL', redisKey]));
    const resetAt = Date.now() + Math.max(ttlMs, 0);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (error) {
    console.warn('[rate-limit][redis-fallback]', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return rateLimit(key, limit, windowMs);
  }
}

export function ipFromRequest(req: Request): string {
  if (shouldTrustProxyHeaders()) {
    try {
      const directIpHeaders = ['x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];
      for (const header of directIpHeaders) {
        const value = req.headers.get(header)?.trim();
        if (value) return value;
      }

      const xff = req.headers.get('x-forwarded-for');
      if (xff) return xff.split(',')[0].trim();
    } catch {
      /* noop */
    }
  }

  // Fallback: sem acesso ao IP direto no edge; usar user-agent + accept-lang como aproximação
  const ua = req.headers.get('user-agent') || 'ua';
  const al = req.headers.get('accept-language') || 'al';
  return `ua:${ua}|al:${al}`;
}
