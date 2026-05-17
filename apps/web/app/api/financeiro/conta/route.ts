import { NextRequest, NextResponse } from 'next/server';

import { safeGetServerSession } from '@/lib/safe-server-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { getAccountBalanceSummary, getAccountOverview } from '@alusa/finance';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateJson, type CacheState } from '@/lib/private-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { logRuntimeEnvironmentOnce } from '@/lib/runtime-environment';

type SessUser = { id?: string; contaId?: string; role?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const SUMMARY_CACHE_MAX_AGE_SECONDS = 30;
const SUMMARY_CACHE_STALE_SECONDS = 30;
const summaryCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
  staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req?: NextRequest) {
  const timer = createPerfTimer('api/financeiro/conta');
  try {
    logRuntimeEnvironmentOnce('api/financeiro/conta');
    const mode = req?.nextUrl.searchParams.get('mode') ?? 'overview';
    const bypassCache = req?.nextUrl.searchParams.get('bypassCache') === '1';
    const session = await withPerfTimer(
      'api/financeiro/conta',
      'auth',
      () => safeGetServerSession(),
    );
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    if (mode === 'summary') {
      if (isCacheLayerEnabled()) {
        const cacheKey = buildTenantCacheKey({
          contaId: user.contaId,
          area: 'finance',
          resource: 'account-summary',
          version: 1,
        });
        const cached: { state: CacheState; body?: unknown } = bypassCache
          ? { state: 'BYPASS' }
          : await getTenantCacheAdapter().get(cacheKey);
        if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
          timer.end('GET /conta summary (tenant cache hit before gate)', {
            contaId: user.contaId,
            cacheState: cached.state,
          });
          return privateJson(cached.body, {
            maxAgeSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
            staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
            cacheState: cached.state,
          });
        }

        const gate = await withPerfTimer(
          'api/financeiro/conta',
          'guardFinancialAccountOr412',
          () => guardFinancialAccountOr412(user.contaId!),
          { contaId: user.contaId, mode },
        );
        if (!gate.ok) return gate.response;

        const summary = await withPerfTimer(
          'financeiro/conta',
          'getAccountBalanceSummary',
          () => getAccountBalanceSummary({ contaId: user.contaId!, kycSummary: gate.summary }),
          { contaId: user.contaId },
        );
        if (!summary.success) {
          const status = summary.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500;
          return json(status, { error: summary.error });
        }

        const body = { data: summary.data };
        await getTenantCacheAdapter().set(cacheKey, body, {
          ttlSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
          staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
        });

        timer.end('GET /conta summary', { contaId: user.contaId, cacheState: cached.state });
        return privateJson(body, {
          maxAgeSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
          staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
          cacheState: cached.state,
        });
      }

      const cacheKey = [user.contaId, user.id, 'summary'].join(':');
      const cached: { state: CacheState; body?: unknown } = bypassCache
        ? { state: 'BYPASS' }
        : summaryCache.get(cacheKey);
      if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
        timer.end('GET /conta summary (cache hit before gate)', { cacheState: cached.state });
        return privateJson(cached.body, {
          maxAgeSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
          staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
          cacheState: cached.state,
        });
      }

      const gate = await withPerfTimer(
        'api/financeiro/conta',
        'guardFinancialAccountOr412',
        () => guardFinancialAccountOr412(user.contaId!),
        { contaId: user.contaId, mode },
      );
      if (!gate.ok) return gate.response;

      const summary = await withPerfTimer(
        'financeiro/conta',
        'getAccountBalanceSummary',
        () => getAccountBalanceSummary({ contaId: user.contaId!, kycSummary: gate.summary }),
        { contaId: user.contaId },
      );
      if (!summary.success) {
        const status = summary.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500;
        return json(status, { error: summary.error });
      }

      const body = { data: summary.data };
      summaryCache.set(cacheKey, body);
      timer.end('GET /conta summary (cache miss)', { cacheState: cached.state });
      return privateJson(body, {
        maxAgeSeconds: SUMMARY_CACHE_MAX_AGE_SECONDS,
        staleWhileRevalidateSeconds: SUMMARY_CACHE_STALE_SECONDS,
        cacheState: cached.state,
      });
    }

    const gate = await withPerfTimer(
      'api/financeiro/conta',
      'guardFinancialAccountOr412',
      () => guardFinancialAccountOr412(user.contaId!),
      { contaId: user.contaId, mode },
    );
    if (!gate.ok) return gate.response;

    const result = await withPerfTimer(
      'financeiro/conta',
      'getAccountOverview',
      () => getAccountOverview({ contaId: user.contaId! }),
      { contaId: user.contaId },
    );
    if (!result.success) {
      const status = result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500;
      return json(status, { error: result.error });
    }

    timer.end('GET /conta overview');
    return json(200, { data: result.data });
  } catch (error) {
    console.error('[API conta][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
