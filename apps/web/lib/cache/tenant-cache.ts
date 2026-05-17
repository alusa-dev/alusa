import type { CacheState } from '@/lib/private-cache';

type CacheEntry<T> = {
  body: T;
  expiresAt: number;
  staleUntil: number;
};

export type TenantCacheAdapter = {
  get<T>(key: string): Promise<{ state: CacheState; body?: T }>;
  set<T>(
    key: string,
    body: T,
    options: { ttlSeconds: number; staleWhileRevalidateSeconds?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  acquireLock?(key: string, ttlSeconds: number): Promise<string | null>;
  releaseLock?(key: string, token: string): Promise<void>;
};

export type TenantCacheKeyInput = {
  env?: string;
  contaId: string;
  area: string;
  resource: string;
  version: number | string;
  filterHash?: string;
};

export type GlobalCacheKeyInput = {
  env?: string;
  area: string;
  resource: string;
  version: number | string;
};

export type WithTenantCacheInput<T> = {
  adapter: TenantCacheAdapter;
  key: string;
  ttlSeconds: number;
  staleWhileRevalidateSeconds?: number;
  lockTtlSeconds?: number;
  waitForLockMs?: number;
  bypass?: boolean;
  load: () => Promise<T>;
};

function normalizeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function isCacheLayerEnabled() {
  return process.env.CACHE_LAYER_ENABLED === 'true';
}

export function shouldEmitCacheDebugHeaders() {
  return process.env.CACHE_DEBUG_HEADERS === 'true';
}

export function buildTenantCacheKey(input: TenantCacheKeyInput) {
  if (!input.contaId?.trim()) {
    throw new Error('Tenant cache key requires contaId');
  }

  const env = normalizeSegment(input.env ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local');
  const contaId = normalizeSegment(input.contaId);
  const area = normalizeSegment(input.area);
  const resource = normalizeSegment(input.resource);
  const version = normalizeSegment(String(input.version).replace(/^v/i, ''));
  const parts = ['alusa', env, 'tenant', contaId, area, resource];

  if (input.filterHash) {
    parts.push(normalizeSegment(input.filterHash));
  }

  parts.push(`v${version}`);
  return parts.join(':');
}

export function buildGlobalCacheKey(input: GlobalCacheKeyInput) {
  const env = normalizeSegment(input.env ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local');
  const area = normalizeSegment(input.area);
  const resource = normalizeSegment(input.resource);
  const version = normalizeSegment(String(input.version).replace(/^v/i, ''));
  return ['alusa', env, 'global', area, resource, `v${version}`].join(':');
}

export class MemoryCacheAdapter implements TenantCacheAdapter {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async get<T>(key: string): Promise<{ state: CacheState; body?: T }> {
    const entry = this.entries.get(key);
    if (!entry) return { state: 'MISS' };

    const now = Date.now();
    if (entry.expiresAt > now) return { state: 'HIT', body: entry.body as T };
    if (entry.staleUntil > now) return { state: 'STALE', body: entry.body as T };

    this.entries.delete(key);
    return { state: 'MISS' };
  }

  async set<T>(
    key: string,
    body: T,
    options: { ttlSeconds: number; staleWhileRevalidateSeconds?: number },
  ): Promise<void> {
    const now = Date.now();
    const staleSeconds = options.staleWhileRevalidateSeconds ?? 0;
    this.entries.set(key, {
      body,
      expiresAt: now + options.ttlSeconds * 1000,
      staleUntil: now + (options.ttlSeconds + staleSeconds) * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const now = Date.now();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return null;

    const token = `${now}:${Math.random().toString(36).slice(2)}`;
    this.locks.set(key, {
      token,
      expiresAt: now + ttlSeconds * 1000,
    });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const current = this.locks.get(key);
    if (current?.token === token) {
      this.locks.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export class NoopCacheAdapter implements TenantCacheAdapter {
  async get<T>(_key: string): Promise<{ state: CacheState; body?: T }> {
    return { state: 'MISS' };
  }

  async set<T>(_key: string, _body: T): Promise<void> {}

  async delete(_key: string): Promise<void> {}
}

type RedisStoredEntry<T> = CacheEntry<T>;

type RedisRestCacheAdapterOptions = {
  url: string;
  token: string;
  maxPayloadBytes?: number;
};

export class RedisRestCacheAdapter implements TenantCacheAdapter {
  private readonly url: string;
  private readonly token: string;
  private readonly maxPayloadBytes: number;

  constructor(options: RedisRestCacheAdapterOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.token = options.token;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 256 * 1024;
  }

  private async command<T = unknown>(command: unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis REST command failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as { result?: T; error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload.result as T;
  }

  async get<T>(key: string): Promise<{ state: CacheState; body?: T }> {
    const raw = await this.command<string | null>(['GET', key]);
    if (!raw) return { state: 'MISS' };

    const entry = JSON.parse(raw) as RedisStoredEntry<T>;
    const now = Date.now();
    if (entry.expiresAt > now) return { state: 'HIT', body: entry.body };
    if (entry.staleUntil > now) return { state: 'STALE', body: entry.body };

    await this.delete(key);
    return { state: 'MISS' };
  }

  async set<T>(
    key: string,
    body: T,
    options: { ttlSeconds: number; staleWhileRevalidateSeconds?: number },
  ): Promise<void> {
    const now = Date.now();
    const staleSeconds = options.staleWhileRevalidateSeconds ?? 0;
    const payload = JSON.stringify({
      body,
      expiresAt: now + options.ttlSeconds * 1000,
      staleUntil: now + (options.ttlSeconds + staleSeconds) * 1000,
    } satisfies RedisStoredEntry<T>);

    if (Buffer.byteLength(payload, 'utf8') > this.maxPayloadBytes) {
      throw new Error('Redis cache payload exceeds maxPayloadBytes');
    }

    await this.command(['SETEX', key, Math.max(1, options.ttlSeconds + staleSeconds), payload]);
  }

  async delete(key: string): Promise<void> {
    await this.command(['DEL', key]);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await this.command<string | null>(['SET', key, token, 'NX', 'EX', ttlSeconds]);
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const current = await this.command<string | null>(['GET', key]);
    if (current === token) {
      await this.delete(key);
    }
  }
}

export class ResilientCacheAdapter implements TenantCacheAdapter {
  constructor(
    private readonly primary: TenantCacheAdapter,
    private readonly fallback: TenantCacheAdapter,
    private readonly options: { label: string },
  ) {}

  private warn(operation: string, error: unknown) {
    console.warn('[cache][fallback]', {
      adapter: this.options.label,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async get<T>(key: string): Promise<{ state: CacheState; body?: T }> {
    try {
      return await this.primary.get<T>(key);
    } catch (error) {
      this.warn('get', error);
      return this.fallback.get<T>(key);
    }
  }

  async set<T>(
    key: string,
    body: T,
    options: { ttlSeconds: number; staleWhileRevalidateSeconds?: number },
  ): Promise<void> {
    try {
      await this.primary.set(key, body, options);
    } catch (error) {
      this.warn('set', error);
      await this.fallback.set(key, body, options);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.primary.delete(key);
    } catch (error) {
      this.warn('delete', error);
    }
    await this.fallback.delete(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    try {
      return await this.primary.acquireLock?.(key, ttlSeconds) ?? this.fallback.acquireLock?.(key, ttlSeconds) ?? null;
    } catch (error) {
      this.warn('acquireLock', error);
      return this.fallback.acquireLock?.(key, ttlSeconds) ?? null;
    }
  }

  async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.primary.releaseLock?.(key, token);
    } catch (error) {
      this.warn('releaseLock', error);
    }
    await this.fallback.releaseLock?.(key, token);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTenantCache<T>({
  adapter,
  key,
  ttlSeconds,
  staleWhileRevalidateSeconds = 0,
  lockTtlSeconds,
  waitForLockMs = 150,
  bypass = false,
  load,
}: WithTenantCacheInput<T>): Promise<{ state: CacheState; body: T }> {
  const cachedBefore = !bypass ? await adapter.get<T>(key) : { state: 'BYPASS' as CacheState };
  if (!bypass) {
    if (cachedBefore.body && (cachedBefore.state === 'HIT' || cachedBefore.state === 'STALE')) {
      return { state: cachedBefore.state, body: cachedBefore.body };
    }
  }

  const lockKey = `${key}:lock`;
  const lockToken = lockTtlSeconds && adapter.acquireLock
    ? await adapter.acquireLock(lockKey, lockTtlSeconds)
    : null;

  if (lockTtlSeconds && adapter.acquireLock && !lockToken) {
    if (cachedBefore.body && cachedBefore.state === 'STALE') {
      return { state: 'STALE', body: cachedBefore.body };
    }

    await sleep(waitForLockMs);
    const cachedAfterWait = await adapter.get<T>(key);
    if (cachedAfterWait.body && (cachedAfterWait.state === 'HIT' || cachedAfterWait.state === 'STALE')) {
      return { state: cachedAfterWait.state, body: cachedAfterWait.body };
    }
  }

  try {
    const body = await load();
    await adapter.set(key, body, { ttlSeconds, staleWhileRevalidateSeconds });
    return { state: bypass ? 'BYPASS' : 'MISS', body };
  } finally {
    if (lockToken && adapter.releaseLock) {
      await adapter.releaseLock(lockKey, lockToken);
    }
  }
}

export async function invalidateTenantCache(
  adapter: TenantCacheAdapter,
  keys: string[],
  metadata?: { contaId?: string; reason?: string; areas?: string[] },
) {
  await Promise.allSettled(keys.map((key) => adapter.delete(key)));
  if (process.env.PERF_LOGS === '1') {
    console.log('[cache][invalidate]', {
      contaId: metadata?.contaId,
      reason: metadata?.reason,
      areas: metadata?.areas,
      count: keys.length,
    });
  }
}
