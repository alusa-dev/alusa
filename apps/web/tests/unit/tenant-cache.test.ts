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

  it('serves stale immediately and refreshes through the scheduled callback', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MemoryCacheAdapter();
      await adapter.set('alusa:test:tenant:ct_a:dashboard:kpis:v1', { value: 1 }, {
        ttlSeconds: 1,
        staleWhileRevalidateSeconds: 30,
      });
      vi.advanceTimersByTime(1_500);
      const scheduled: Array<() => Promise<void>> = [];
      const load = vi.fn(async () => ({ value: 2 }));

      const result = await withTenantCache({
        adapter,
        key: 'alusa:test:tenant:ct_a:dashboard:kpis:v1',
        ttlSeconds: 1,
        staleWhileRevalidateSeconds: 30,
        lockTtlSeconds: 10,
        scheduleStaleRevalidation: (callback) => scheduled.push(callback),
        load,
      });

      expect(result).toEqual({ state: 'STALE', body: { value: 1 } });
      expect(load).not.toHaveBeenCalled();
      await scheduled[0]?.();
      expect(load).toHaveBeenCalledTimes(1);
      expect(await adapter.get('alusa:test:tenant:ct_a:dashboard:kpis:v1')).toEqual({
        state: 'HIT',
        body: { value: 2 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the distributed lock to avoid concurrent stale refreshes', async () => {
    vi.useFakeTimers();
    try {
      const primary = new MemoryCacheAdapter();
      const fallbackA = new MemoryCacheAdapter();
      const fallbackB = new MemoryCacheAdapter();
      const fallbackAAcquireLock = vi.spyOn(fallbackA, 'acquireLock');
      const fallbackBAcquireLock = vi.spyOn(fallbackB, 'acquireLock');
      const adapterA = new ResilientCacheAdapter(primary, fallbackA, { label: 'worker-a' });
      const adapterB = new ResilientCacheAdapter(primary, fallbackB, { label: 'worker-b' });
      const key = 'alusa:test:tenant:ct_a:dashboard:kpis:v1';
      await primary.set(key, { value: 1 }, { ttlSeconds: 1, staleWhileRevalidateSeconds: 30 });
      vi.advanceTimersByTime(1_500);
      const scheduled: Array<() => Promise<void>> = [];
      const load = vi.fn(async () => ({ value: 2 }));
      const optionsA = {
        adapter: adapterA,
        key,
        ttlSeconds: 1,
        staleWhileRevalidateSeconds: 30,
        lockTtlSeconds: 10,
        scheduleStaleRevalidation: (callback: () => Promise<void>) => scheduled.push(callback),
        load,
      };
      const optionsB = {
        ...optionsA,
        adapter: adapterB,
      };

      await Promise.all([withTenantCache(optionsA), withTenantCache(optionsB)]);
      await Promise.all(scheduled.map((callback) => callback()));

      expect(load).toHaveBeenCalledTimes(1);
      expect(fallbackAAcquireLock).not.toHaveBeenCalled();
      expect(fallbackBAcquireLock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fall back when the primary lock is already held', async () => {
    const primary = {
      get: vi.fn(async () => ({ state: 'MISS' as const })),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      acquireLock: vi.fn(async () => null),
    };
    const fallback = {
      get: vi.fn(async () => ({ state: 'MISS' as const })),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      acquireLock: vi.fn(async () => 'fallback-token'),
    };
    const adapter = new ResilientCacheAdapter(primary, fallback, { label: 'test-primary-lock-held' });

    await expect(adapter.acquireLock('k-lock-held', 10)).resolves.toBeNull();
    expect(primary.acquireLock).toHaveBeenCalledTimes(1);
    expect(fallback.acquireLock).not.toHaveBeenCalled();
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
