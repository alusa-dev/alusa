import { describe, expect, it, vi } from 'vitest';

import {
  buildTenantCacheKey,
  MemoryCacheAdapter,
  NoopCacheAdapter,
  ResilientCacheAdapter,
  withTenantCache,
} from '@/lib/cache/tenant-cache';

describe('tenant cache', () => {
  it('builds tenant-scoped keys with contaId', () => {
    expect(
      buildTenantCacheKey({
        env: 'prod',
        contaId: 'ct_1',
        area: 'dashboard',
        resource: 'metrics',
        version: 1,
      }),
    ).toBe('alusa:prod:tenant:ct_1:dashboard:metrics:v1');
  });

  it('rejects tenant keys without contaId', () => {
    expect(() =>
      buildTenantCacheKey({
        env: 'prod',
        contaId: '',
        area: 'dashboard',
        resource: 'metrics',
        version: 1,
      }),
    ).toThrow('Tenant cache key requires contaId');
  });

  it('returns MISS then HIT for memory cache', async () => {
    const adapter = new MemoryCacheAdapter();
    const load = vi.fn(async () => ({ ok: true }));

    const first = await withTenantCache({
      adapter,
      key: 'alusa:test:tenant:ct_1:dashboard:metrics:v1',
      ttlSeconds: 30,
      load,
    });
    const second = await withTenantCache({
      adapter,
      key: 'alusa:test:tenant:ct_1:dashboard:metrics:v1',
      ttlSeconds: 30,
      load,
    });

    expect(first.state).toBe('MISS');
    expect(second.state).toBe('HIT');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('returns STALE inside stale window', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MemoryCacheAdapter();
      await adapter.set('k', { ok: true }, { ttlSeconds: 1, staleWhileRevalidateSeconds: 10 });

      vi.advanceTimersByTime(1500);

      expect(await adapter.get('k')).toEqual({ state: 'STALE', body: { ok: true } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bypasses reads but refreshes the value', async () => {
    const adapter = new MemoryCacheAdapter();
    await adapter.set('k', { value: 1 }, { ttlSeconds: 30 });

    const result = await withTenantCache({
      adapter,
      key: 'k',
      ttlSeconds: 30,
      bypass: true,
      load: async () => ({ value: 2 }),
    });

    expect(result).toEqual({ state: 'BYPASS', body: { value: 2 } });
    expect(await adapter.get('k')).toEqual({ state: 'HIT', body: { value: 2 } });
  });

  it('noop adapter preserves fallback behavior', async () => {
    const adapter = new NoopCacheAdapter();
    const load = vi.fn(async () => ({ ok: true }));

    await withTenantCache({ adapter, key: 'k', ttlSeconds: 30, load });
    await withTenantCache({ adapter, key: 'k', ttlSeconds: 30, load });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('falls back when the primary adapter fails', async () => {
    const primary = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(async () => {
        throw new Error('redis down');
      }),
      delete: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const fallback = new MemoryCacheAdapter();
    const adapter = new ResilientCacheAdapter(primary, fallback, { label: 'test-primary' });

    const result = await withTenantCache({
      adapter,
      key: 'k',
      ttlSeconds: 30,
      load: async () => ({ ok: true }),
    });

    expect(result).toEqual({ state: 'MISS', body: { ok: true } });
    expect(await fallback.get('k')).toEqual({ state: 'HIT', body: { ok: true } });
  });

  it('uses a short lock to avoid duplicate recalculation', async () => {
    const adapter = new MemoryCacheAdapter();
    const load = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { value: 1 };
    });

    const [first, second] = await Promise.all([
      withTenantCache({ adapter, key: 'k-lock', ttlSeconds: 30, lockTtlSeconds: 1, waitForLockMs: 20, load }),
      withTenantCache({ adapter, key: 'k-lock', ttlSeconds: 30, lockTtlSeconds: 1, waitForLockMs: 20, load }),
    ]);

    expect(first.body).toEqual({ value: 1 });
    expect(second.body).toEqual({ value: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
