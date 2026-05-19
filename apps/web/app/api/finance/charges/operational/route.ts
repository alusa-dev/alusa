import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { listOperationalCharges } from '@alusa/finance';

import { buildTenantCacheKey, withTenantCache } from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { isCacheLayerEnabled } from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { withPerfTimer } from '@/lib/perf-logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCEIRO']);
const OPERATIONAL_CACHE_SECONDS = 20;
const OPERATIONAL_STALE_SECONDS = 40;

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function buildOperationalCacheKey(
  contaId: string,
  params: { page: number; pageSize: number; search?: string; tipoFilter?: string[] },
) {
  const fingerprint = createHash('sha1')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 12);

  return buildTenantCacheKey({
    contaId,
    area: 'charges',
    resource: 'operational-list',
    version: 1,
    filterHash: fingerprint,
  });
}

/**
 * GET /api/finance/charges/operational
 */
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !ALLOWED_ROLES.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const search = url.searchParams.get('q')?.trim() || undefined;
    const tipoFilter = url.searchParams.getAll('tipo').filter(Boolean);
    const contaId = user.contaId!;

    const load = () =>
      withPerfTimer(
        'finance',
        'listOperationalCharges',
        () =>
          listOperationalCharges({
            contaId,
            page,
            pageSize,
            search,
            tipoFilter: tipoFilter.length ? tipoFilter : undefined,
          }),
        { contaId },
      );

    if (!isCacheLayerEnabled()) {
      const result = await load();
      return NextResponse.json(
        {
          data: result.items,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildOperationalCacheKey(contaId, { page, pageSize, search, tipoFilter }),
      ttlSeconds: OPERATIONAL_CACHE_SECONDS,
      staleWhileRevalidateSeconds: OPERATIONAL_STALE_SECONDS,
      lockTtlSeconds: 8,
      load,
    });

    return privateJson(
      {
        data: cached.body.items,
        total: cached.body.total,
        page: cached.body.page,
        pageSize: cached.body.pageSize,
        totalPages: cached.body.totalPages,
      },
      {
        maxAgeSeconds: OPERATIONAL_CACHE_SECONDS,
        staleWhileRevalidateSeconds: OPERATIONAL_STALE_SECONDS,
        cacheState: cached.state,
      },
    );
  } catch (e) {
    console.error('[API finance/charges/operational] Erro:', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
