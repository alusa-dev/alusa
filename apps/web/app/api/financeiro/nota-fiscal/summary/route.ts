import type { InvoiceStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { listNotaFiscalPersonIndexResultDTOSchema } from '@/features/financeiro/notafiscal/dtos';
import { mapListNotaFiscalPersonIndexResultToDTO } from '@/features/financeiro/notafiscal/mappers';
import { financeInternalError, financeJsonError, logFinanceApiRequest, stableQueryFingerprint } from '@/lib/api/finance-api-response';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { listFiscalInvoicePersonIndex } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const NOTA_FISCAL_SUMMARY_CACHE_SECONDS = 60;
const NOTA_FISCAL_SUMMARY_STALE_SECONDS = 60;
const allowedStatuses = new Set<InvoiceStatus>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
]);

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

function parseStatusFilters(values: string[]): InvoiceStatus[] {
  return values
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is InvoiceStatus => allowedStatuses.has(value as InvoiceStatus));
}

function buildNotaFiscalSummaryCacheKey(
  contaId: string,
  params: {
    search?: string;
    statusFilters: InvoiceStatus[];
    effectiveDateFrom?: string;
    effectiveDateTo?: string;
    page: number;
    pageSize: number;
  },
) {
  return buildTenantCacheKey({
    contaId,
    area: 'finance',
    resource: 'nota-fiscal-summary',
    version: 1,
    filterHash: stableQueryFingerprint({
      search: params.search ?? '',
      statusFilters: [...params.statusFilters].sort(),
      effectiveDateFrom: params.effectiveDateFrom ?? '',
      effectiveDateTo: params.effectiveDateTo ?? '',
      page: params.page,
      pageSize: params.pageSize,
    }),
  });
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  let cacheState: 'HIT' | 'MISS' | 'STALE' | 'BYPASS' | undefined;
  let contaId: string | undefined;

  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    contaId = user.contaId;
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const url = new URL(req.url);
    const search = url.searchParams.get('q')?.trim() || undefined;
    const statusFilters = parseStatusFilters(url.searchParams.getAll('status'));
    const effectiveDateFrom = url.searchParams.get('effectiveDateFrom')?.trim() || undefined;
    const effectiveDateTo = url.searchParams.get('effectiveDateTo')?.trim() || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));

    const loadBody = async () => {
      const result = await listFiscalInvoicePersonIndex({
        contaId: user.contaId!,
        search,
        statusFilters: statusFilters.length ? statusFilters : undefined,
        effectiveDateFrom,
        effectiveDateTo,
        page,
        pageSize,
      });

      return listNotaFiscalPersonIndexResultDTOSchema.parse(mapListNotaFiscalPersonIndexResultToDTO(result));
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(await loadBody(), { headers: { 'cache-control': 'no-store' } });
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildNotaFiscalSummaryCacheKey(user.contaId, {
        search,
        statusFilters,
        effectiveDateFrom,
        effectiveDateTo,
        page,
        pageSize,
      }),
      ttlSeconds: NOTA_FISCAL_SUMMARY_CACHE_SECONDS,
      staleWhileRevalidateSeconds: NOTA_FISCAL_SUMMARY_STALE_SECONDS,
      lockTtlSeconds: 12,
      waitForLockMs: 400,
      load: loadBody,
    });
    cacheState = cached.state;

    return privateJson(cached.body, {
      maxAgeSeconds: NOTA_FISCAL_SUMMARY_CACHE_SECONDS,
      staleWhileRevalidateSeconds: NOTA_FISCAL_SUMMARY_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (error) {
    return financeInternalError('API Financeiro Nota Fiscal Summary', error);
  } finally {
    logFinanceApiRequest('GET /api/financeiro/nota-fiscal/summary', {
      contaId,
      durationMs: Date.now() - startedAt,
      cacheHit: cacheState,
    });
  }
}
