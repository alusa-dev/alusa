import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getFinanceiroKpisLocal } from '@alusa/finance';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { privateJson } from '@/lib/private-cache';
import {
  financeiroKpisResultDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroKpisResultToDTO } from '@/features/financeiro/mappers';
import { financeInternalError, financeJsonError, logFinanceApiRequest } from '@/lib/api/finance-api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const FINANCEIRO_KPIS_CACHE_SECONDS = 15;
const FINANCEIRO_KPIS_STALE_SECONDS = 30;

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

function buildFinanceiroKpisCacheKey(contaId: string, mesParam: string | null) {
  return buildTenantCacheKey({
    contaId,
    area: 'finance',
    resource: 'financeiro-kpis',
    version: 1,
    filterHash: mesParam ?? 'current',
  });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  let cacheState: 'HIT' | 'MISS' | 'STALE' | 'BYPASS' | undefined;
  let contaId: string | undefined;

  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuário não autenticado');
    contaId = auth.contaId;
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { searchParams } = new URL(request.url);
    const mesParam = searchParams.get('mes'); // formato: YYYY-MM
    
    const agora = new Date();
    // Definir início do dia atual para cálculo correto de vencimento (venceu se < início de hoje? ou < agora?)
    // Regra geral: venceu se data de vencimento < hoje (ignora hora).
    // Se vencimento é hoje, ainda não venceu (o cliente tem até o fim do dia).
    const startOfToday = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const endOfNext30Days = new Date(startOfToday);
    endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
    endOfNext30Days.setHours(23, 59, 59, 999);

    const mesAtual = mesParam 
      ? new Date(`${mesParam}-01T00:00:00Z`) 
      : new Date(agora.getFullYear(), agora.getMonth(), 1);
    const proximoMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1);
    const loadBody = async () => {
      const localSnapshot = await getFinanceiroKpisLocal({
        contaId: auth.contaId,
        mesAtual,
        proximoMes,
        startOfToday,
        endOfNext30Days,
      });

      return financeiroKpisResultDTOSchema.parse(mapFinanceiroKpisResultToDTO({ data: localSnapshot.data }));
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(
        await loadBody(),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildFinanceiroKpisCacheKey(auth.contaId, mesParam),
      ttlSeconds: FINANCEIRO_KPIS_CACHE_SECONDS,
      staleWhileRevalidateSeconds: FINANCEIRO_KPIS_STALE_SECONDS,
      lockTtlSeconds: 8,
      waitForLockMs: 400,
      load: loadBody,
    });
    cacheState = cached.state;

    return privateJson(cached.body, {
      maxAgeSeconds: FINANCEIRO_KPIS_CACHE_SECONDS,
      staleWhileRevalidateSeconds: FINANCEIRO_KPIS_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (e) {
    return financeInternalError('API Financeiro KPIs', e);
  } finally {
    logFinanceApiRequest('GET /api/financeiro/kpis', {
      contaId,
      durationMs: Date.now() - startedAt,
      cacheHit: cacheState,
    });
  }
}
