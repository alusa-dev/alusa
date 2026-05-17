import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { dashboardFinanceKpisResultDTOSchema } from '@/features/dashboard/dtos';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { createPerfTimer, logRoutePerformance } from '@/lib/perf-logger';
import { logRuntimeEnvironmentOnce } from '@/lib/runtime-environment';

const dashboardFinanceKpisCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 15,
  staleWhileRevalidateSeconds: 60,
});
const CACHE_MAX_AGE_SECONDS = 15;
const CACHE_STALE_SECONDS = 60;

async function buildFinanceKpisBody(contaId: string) {
  const snapshot = await getDashboardFinanceKpisLocal({ contaId });
  return dashboardFinanceKpisResultDTOSchema.parse({
    success: true,
    data: snapshot,
  });
}

export async function GET() {
  const startedAt = Date.now();
  const timer = createPerfTimer('api/dashboard/finance-kpis');
  let contaIdForLog: string | null = null;
  let cacheStateForLog = 'BYPASS';
  let statusCodeForLog = 200;

  try {
    logRuntimeEnvironmentOnce('api/dashboard/finance-kpis');
    const session = await getServerSession(authOptions);
    const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;
    contaIdForLog = contaId ?? null;

    if (!contaId) {
      statusCodeForLog = 401;
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    if (isCacheLayerEnabled()) {
      const cached = await withTenantCache({
        adapter: getTenantCacheAdapter(),
        key: buildTenantCacheKey({
          contaId,
          area: 'dashboard',
          resource: 'finance-kpis',
          version: 1,
        }),
        ttlSeconds: CACHE_MAX_AGE_SECONDS,
        staleWhileRevalidateSeconds: CACHE_STALE_SECONDS,
        lockTtlSeconds: 10,
        load: () => buildFinanceKpisBody(contaId),
      });
      cacheStateForLog = cached.state;
      timer.end('GET /dashboard/finance-kpis', { contaId, cacheState: cached.state });
      return privateJson(cached.body, {
        maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
        staleWhileRevalidateSeconds: CACHE_STALE_SECONDS,
        cacheState: cached.state,
      });
    }

    const cached = dashboardFinanceKpisCache.get(contaId);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      cacheStateForLog = cached.state;
      return privateJson(cached.body, {
        maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
        staleWhileRevalidateSeconds: CACHE_STALE_SECONDS,
        cacheState: cached.state,
      });
    }

    const body = await buildFinanceKpisBody(contaId);

    dashboardFinanceKpisCache.set(contaId, body);
    cacheStateForLog = 'MISS';

    return privateJson(body, {
      maxAgeSeconds: CACHE_MAX_AGE_SECONDS,
      staleWhileRevalidateSeconds: CACHE_STALE_SECONDS,
      cacheState: 'MISS',
    });
  } catch (error) {
    statusCodeForLog = 500;
    console.error('[GET /api/dashboard/finance-kpis] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  } finally {
    logRoutePerformance({
      route: 'api/dashboard/finance-kpis',
      method: 'GET',
      contaId: contaIdForLog,
      durationMs: Date.now() - startedAt,
      cacheState: cacheStateForLog,
      statusCode: statusCodeForLog,
    });
  }
}
