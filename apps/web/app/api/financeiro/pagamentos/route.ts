import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { listFinanceiroPagamentosResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoRecordToDTO } from '@/features/financeiro/mappers';
import { financeInternalError, financeJsonError, stableQueryFingerprint } from '@/lib/api/finance-api-response';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';
import { listFinanceiroPagamentos } from '@/src/server/finance/payment-list.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const PAGAMENTOS_CACHE_SECONDS = 45;
const PAGAMENTOS_STALE_SECONDS = 45;

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

function buildPagamentosCacheKey(
  contaId: string,
  params: {
    page: number;
    pageSize: number;
    status: string[];
    formaPagamento: string[];
    cobrancaId?: string;
    search?: string;
  },
) {
  return buildTenantCacheKey({
    contaId,
    area: 'finance',
    resource: 'pagamentos',
    version: 1,
    filterHash: stableQueryFingerprint({
      page: params.page,
      pageSize: params.pageSize,
      status: [...params.status].sort(),
      formaPagamento: [...params.formaPagamento].sort(),
      cobrancaId: params.cobrancaId ?? '',
      search: params.search ?? '',
    }),
  });
}

// GET /api/financeiro/pagamentos
// Filtros: status, formaPagamento, q (aluno ou descricao da cobrança), cobrancaId
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const status = url.searchParams.getAll('status');
    const formaPagamento = url.searchParams.getAll('formaPagamento');
    const cobrancaId = url.searchParams.get('cobrancaId') || undefined;
    const search = url.searchParams.get('q')?.trim();

    const loadBody = async () => {
      const result = await listFinanceiroPagamentos({
        contaId: auth.contaId,
        page,
        pageSize,
        status,
        formaPagamento,
        cobrancaId,
        search,
      });

      return listFinanceiroPagamentosResultDTOSchema.parse({
        data: result.data.map((item) => mapFinanceiroPagamentoRecordToDTO(item)),
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
      });
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(await loadBody(), { headers: { 'cache-control': 'no-store' } });
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildPagamentosCacheKey(auth.contaId, {
        page,
        pageSize,
        status,
        formaPagamento,
        cobrancaId,
        search,
      }),
      ttlSeconds: PAGAMENTOS_CACHE_SECONDS,
      staleWhileRevalidateSeconds: PAGAMENTOS_STALE_SECONDS,
      lockTtlSeconds: 8,
      load: loadBody,
    });

    return privateJson(cached.body, {
      maxAgeSeconds: PAGAMENTOS_CACHE_SECONDS,
      staleWhileRevalidateSeconds: PAGAMENTOS_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (e) {
    return financeInternalError('API Financeiro Pagamentos', e);
  }
}
