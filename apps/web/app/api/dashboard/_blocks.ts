import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { buildTenantCacheKey, withTenantCache } from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import {
  avatarVersionFromFoto,
  resolveAlunoPublicAvatar,
  resolvePublicAvatarUrl,
  type AvatarEntity,
} from '@/lib/media/avatar-url';
import { logRoutePerformance } from '@/lib/perf-logger';
import { privateJson } from '@/lib/private-cache';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

export const DASHBOARD_BLOCK_CACHE_SECONDS = 15;
export const DASHBOARD_BLOCK_STALE_SECONDS = 60;

export async function requireDashboardBlockContaId() {
  if (process.env.DASHBOARD_BLOCKS_ENABLED !== 'true') {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'DASHBOARD_BLOCKS_DISABLED' },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  const session = await getServerSession(authOptions);
  const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;
  if (!contaId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const, contaId };
}

export async function cachedDashboardBlockWithTenant<T>(
  contaId: string,
  resource: string,
  load: (tx: TenantTransactionClient) => Promise<T>,
) {
  return cachedDashboardBlock(contaId, resource, () => runWithTenant(contaId, load));
}

export async function cachedDashboardBlock<T>(
  contaId: string,
  resource: string,
  load: () => Promise<T>,
) {
  const startedAt = Date.now();
  const route = `api/dashboard/${resource}`;
  const cached = await withTenantCache({
    adapter: getTenantCacheAdapter(),
    key: buildTenantCacheKey({ contaId, area: 'dashboard', resource, version: 1 }),
    ttlSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
    staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
    lockTtlSeconds: 10,
    load,
  });

  logRoutePerformance({
    route,
    method: 'GET',
    contaId,
    durationMs: Date.now() - startedAt,
    cacheState: cached.state,
    statusCode: 200,
  });

  return privateJson(cached.body, {
    maxAgeSeconds: DASHBOARD_BLOCK_CACHE_SECONDS,
    staleWhileRevalidateSeconds: DASHBOARD_BLOCK_STALE_SECONDS,
    cacheState: cached.state,
  });
}

export function publicImageUrl(
  value: string | null | undefined,
  options?: { entity?: AvatarEntity; id?: string; updatedAt?: Date | string | null },
) {
  if (!value) return null;
  if (options?.entity && options?.id) {
    return resolvePublicAvatarUrl({
      entity: options.entity,
      id: options.id,
      foto: value,
      version: avatarVersionFromFoto(value, options.updatedAt),
    });
  }
  if (value.startsWith('data:image/')) return null;
  return value;
}

export { resolveAlunoPublicAvatar };

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
