import { NextResponse } from 'next/server';

type CacheEntry<T> = {
  body: T;
  expiresAt: number;
  staleUntil: number;
};

type PrivateCacheOptions = {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
};

export type CacheState = 'HIT' | 'MISS' | 'STALE' | 'BYPASS';

export function privateCacheControl({
  maxAgeSeconds,
  staleWhileRevalidateSeconds = 0,
}: PrivateCacheOptions) {
  const directives = ['private', `max-age=${maxAgeSeconds}`];
  if (staleWhileRevalidateSeconds > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidateSeconds}`);
  }
  return directives.join(', ');
}

export function privateJson<T>(
  body: T,
  options: PrivateCacheOptions & { status?: number; cacheState?: CacheState; headers?: Record<string, string> },
) {
  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: {
      'cache-control': privateCacheControl(options),
      ...(options.cacheState ? { 'x-alusa-cache': options.cacheState } : {}),
      ...options.headers,
    },
  });
}

export class PrivateMemoryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly options: PrivateCacheOptions;

  constructor(options: PrivateCacheOptions) {
    this.options = options;
  }

  get(key: string): { state: CacheState; body?: T } {
    const entry = this.entries.get(key);
    if (!entry) return { state: 'MISS' };

    const now = Date.now();
    if (entry.expiresAt > now) return { state: 'HIT', body: entry.body };
    if (entry.staleUntil > now) return { state: 'STALE', body: entry.body };

    this.entries.delete(key);
    return { state: 'MISS' };
  }

  set(key: string, body: T) {
    const now = Date.now();
    const staleWhileRevalidateSeconds = this.options.staleWhileRevalidateSeconds ?? 0;
    this.entries.set(key, {
      body,
      expiresAt: now + this.options.maxAgeSeconds * 1000,
      staleUntil: now + (this.options.maxAgeSeconds + staleWhileRevalidateSeconds) * 1000,
    });
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}
