import {
  buildTenantCacheKey,
  MemoryCacheAdapter,
  type TenantCacheAdapter,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';

const FEED_RESOURCE = 'feed';
const COUNT_RESOURCE = 'unread-count';

type CacheGlobals = typeof globalThis & {
  __alusaNotificationMemoryCache?: MemoryCacheAdapter;
};

function getLocalNotificationCache() {
  const globalForCache = globalThis as CacheGlobals;
  globalForCache.__alusaNotificationMemoryCache ??= new MemoryCacheAdapter();
  return globalForCache.__alusaNotificationMemoryCache;
}

function getNotificationCacheAdapter(): TenantCacheAdapter {
  // Reuse the repository's shared Redis/Upstash adapter when enabled. Local
  // development keeps the previous in-process behavior without Redis.
  return process.env.CACHE_LAYER_ENABLED === 'true'
    ? getTenantCacheAdapter()
    : getLocalNotificationCache();
}

export function buildNotificationFeedCacheKey(params: {
  contaId: string;
  userId: string;
  view: string;
  limit: number | string;
  page: number | string;
}) {
  return buildTenantCacheKey({
    contaId: params.contaId,
    area: 'notifications',
    resource: FEED_RESOURCE,
    version: 1,
    filterHash: `${params.userId}:${params.view}:${params.limit}:${params.page}`,
  });
}

export function buildNotificationFeedCachePrefix(contaId: string, userId: string) {
  const key = buildTenantCacheKey({
    contaId,
    area: 'notifications',
    resource: FEED_RESOURCE,
    version: 1,
    filterHash: userId,
  });
  return `${key.slice(0, key.lastIndexOf(':'))}-`;
}

export function buildNotificationUnreadCountCacheKey(contaId: string, userId: string) {
  return buildTenantCacheKey({
    contaId,
    area: 'notifications',
    resource: COUNT_RESOURCE,
    version: 1,
    filterHash: userId,
  });
}

export function getNotificationCache<T>(key: string) {
  return getNotificationCacheAdapter().get<T>(key);
}

export function setNotificationCache<T>(
  key: string,
  body: T,
  options: { ttlSeconds: number; staleWhileRevalidateSeconds?: number },
) {
  return getNotificationCacheAdapter().set(key, body, options);
}

export async function clearNotificationCaches(scope?: { contaId: string; userId: string }) {
  const adapter = getNotificationCacheAdapter();
  if (!scope) {
    // Local tests/dev can clear the process cache. Redis intentionally remains
    // untouched because a global flush could evict another tenant's data.
    if (adapter instanceof MemoryCacheAdapter) adapter.clear();
    return;
  }

  await Promise.all([
    adapter.deleteByPrefix?.(buildNotificationFeedCachePrefix(scope.contaId, scope.userId)),
    adapter.delete(buildNotificationUnreadCountCacheKey(scope.contaId, scope.userId)),
  ]);
}
