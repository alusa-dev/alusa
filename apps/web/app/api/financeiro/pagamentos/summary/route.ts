import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import {
  listFinanceiroPagamentoPessoaIndexResultDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoPessoaIndexItemToDTO } from '@/features/financeiro/mappers';
import { financeInternalError, financeJsonError, logFinanceApiRequest, stableQueryFingerprint } from '@/lib/api/finance-api-response';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';
import { listPersonPaymentLedgerIndex } from '@/src/server/finance/person-payment-ledger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const PAGAMENTOS_SUMMARY_CACHE_SECONDS = 45;
const PAGAMENTOS_SUMMARY_STALE_SECONDS = 45;

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

function buildPagamentosSummaryCacheKey(
  contaId: string,
  params: { search?: string; statusFilters: string[]; page: number; pageSize: number },
) {
  return buildTenantCacheKey({
    contaId,
    area: 'finance',
    resource: 'pagamentos-summary',
    version: 1,
    filterHash: stableQueryFingerprint({
      search: params.search ?? '',
      statusFilters: [...params.statusFilters].sort(),
      page: params.page,
      pageSize: params.pageSize,
    }),
  });
}

// GET /api/financeiro/pagamentos/summary
// Retorna o índice financeiro local por pessoa (aluno e responsável).
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
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const search = url.searchParams.get('q')?.trim() || undefined;
    const statusFilters = url.searchParams.getAll('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));

    const loadBody = async () => {
      const result = await listPersonPaymentLedgerIndex({
        contaId: user.contaId!,
        search,
        statusFilters,
        page,
        pageSize,
      });

      return listFinanceiroPagamentoPessoaIndexResultDTOSchema.parse({
        ...result,
        data: result.data.map((item) => mapFinanceiroPagamentoPessoaIndexItemToDTO(item)),
      });
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(await loadBody(), { headers: { 'cache-control': 'no-store' } });
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildPagamentosSummaryCacheKey(user.contaId, { search, statusFilters, page, pageSize }),
      ttlSeconds: PAGAMENTOS_SUMMARY_CACHE_SECONDS,
      staleWhileRevalidateSeconds: PAGAMENTOS_SUMMARY_STALE_SECONDS,
      lockTtlSeconds: 10,
      waitForLockMs: 400,
      load: loadBody,
    });
    cacheState = cached.state;

    return privateJson(cached.body, {
      maxAgeSeconds: PAGAMENTOS_SUMMARY_CACHE_SECONDS,
      staleWhileRevalidateSeconds: PAGAMENTOS_SUMMARY_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (e) {
    return financeInternalError('API Financeiro Pagamentos Summary', e);
  } finally {
    logFinanceApiRequest('GET /api/financeiro/pagamentos/summary', {
      contaId,
      durationMs: Date.now() - startedAt,
      cacheHit: cacheState,
    });
  }
}
