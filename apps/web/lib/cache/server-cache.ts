import {
  MemoryCacheAdapter,
  NoopCacheAdapter,
  RedisRestCacheAdapter,
  ResilientCacheAdapter,
  type TenantCacheAdapter,
} from './tenant-cache';

type CacheGlobals = typeof globalThis & {
  __alusaTenantCacheAdapter?: TenantCacheAdapter;
  __alusaTenantMemoryCacheAdapter?: MemoryCacheAdapter;
};

function getMemoryFallback() {
  const globalForCache = globalThis as CacheGlobals;
  globalForCache.__alusaTenantMemoryCacheAdapter ??= new MemoryCacheAdapter();
  return globalForCache.__alusaTenantMemoryCacheAdapter;
}

function getRedisRestConfig() {
  const configuredUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.REDIS_URL?.trim();
  const url = configuredUrl?.startsWith('http') ? configuredUrl : undefined;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.REDIS_TOKEN?.trim();

  if (!url || !token) return null;
  return { url, token };
}

export function getTenantCacheAdapter(): TenantCacheAdapter {
  const globalForCache = globalThis as CacheGlobals;
  if (globalForCache.__alusaTenantCacheAdapter) {
    return globalForCache.__alusaTenantCacheAdapter;
  }

  if (process.env.CACHE_LAYER_ENABLED !== 'true') {
    globalForCache.__alusaTenantCacheAdapter = new NoopCacheAdapter();
    return globalForCache.__alusaTenantCacheAdapter;
  }

  const memoryFallback = getMemoryFallback();
  const redisConfig = process.env.REDIS_CACHE_ENABLED === 'true' ? getRedisRestConfig() : null;

  globalForCache.__alusaTenantCacheAdapter = redisConfig
    ? new ResilientCacheAdapter(
        new RedisRestCacheAdapter(redisConfig),
        memoryFallback,
        { label: 'redis-rest' },
      )
    : memoryFallback;

  return globalForCache.__alusaTenantCacheAdapter;
}

export function resetTenantCacheAdapterForTests() {
  const globalForCache = globalThis as CacheGlobals;
  delete globalForCache.__alusaTenantCacheAdapter;
  delete globalForCache.__alusaTenantMemoryCacheAdapter;
}
