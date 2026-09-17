import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { loadDashboardMetricsBody } from '@/lib/dashboard/load-dashboard-metrics';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { logRoutePerformance, createPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';
import { logRuntimeEnvironmentOnce } from '@/lib/runtime-environment';

import {
  DASHBOARD_BLOCK_CACHE_SECONDS,
  DASHBOARD_BLOCK_STALE_SECONDS,
} from '../_blocks';

const dashboardMetricsCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
  staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
});

export async function GET(_request: NextRequest) {
  const startedAt = Date.now();
  const timer = createPerfTimer('api/dashboard/metrics');
  let contaIdForLog: string | null = null;
  let cacheStateForLog = 'BYPASS';
  let statusCodeForLog = 200;

  try {
    logRuntimeEnvironmentOnce('api/dashboard/metrics');
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      statusCodeForLog = 401;
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }
    const { contaId } = auth;
    contaIdForLog = contaId;

    const cacheLayerEnabled = isCacheLayerEnabled();
    const tenantCacheKey = cacheLayerEnabled
      ? buildTenantCacheKey({
          contaId,
          area: 'dashboard',
          resource: 'metrics',
          version: 1,
        })
      : null;

    if (!cacheLayerEnabled) {
      const cached = dashboardMetricsCache.get(contaId);
      if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
        cacheStateForLog = cached.state;
        timer.end('GET /dashboard/metrics (memory cache hit)', { contaId, cacheState: cached.state });
        return privateJson(cached.body, {
          maxAgeSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
          staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
          cacheState: cached.state,
        });
      }
    }

    const loadBody = async () => loadDashboardMetricsBody(contaId);

    const loaded = tenantCacheKey
      ? await withTenantCache({
          adapter: getTenantCacheAdapter(),
          key: tenantCacheKey,
          ttlSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
          staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
          lockTtlSeconds: 10,
          load: loadBody,
        })
      : { state: 'MISS' as const, body: await loadBody() };

    cacheStateForLog = loaded.state;
    if (!tenantCacheKey) {
      dashboardMetricsCache.set(contaId, loaded.body);
    }

    timer.end('GET /dashboard/metrics (success)', { contaId, cacheState: cacheStateForLog });
    return privateJson(loaded.body, {
      maxAgeSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
      staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
      cacheState: loaded.state,
    });
  } catch (error) {
    statusCodeForLog = 500;
    console.error('[GET /api/dashboard/metrics] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Não foi possível carregar as métricas agora.',
      },
      { status: 500 },
    );
  } finally {
    logRoutePerformance({
      route: 'api/dashboard/metrics',
      method: 'GET',
      contaId: contaIdForLog,
      durationMs: Date.now() - startedAt,
      cacheState: cacheStateForLog,
      statusCode: statusCodeForLog,
    });
  }
}
