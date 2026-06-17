import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getFinanceiroKpisLocal } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { privateJson } from '@/lib/private-cache';
import { financeiroIndicadoresResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroIndicadoresResultToDTO } from '@/features/financeiro/mappers';
import { financeInternalError, financeJsonError, logFinanceApiRequest } from '@/lib/api/finance-api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const FINANCEIRO_INDICADORES_CACHE_SECONDS = 15;
const FINANCEIRO_INDICADORES_STALE_SECONDS = 30;

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

function buildFinanceiroIndicadoresCacheKey(contaId: string) {
  return buildTenantCacheKey({
    contaId,
    area: 'finance',
    resource: 'financeiro-indicadores',
    version: 1,
  });
}

export async function GET() {
  const startedAt = Date.now();
  let cacheState: 'HIT' | 'MISS' | 'STALE' | 'BYPASS' | undefined;
  let contaId: string | undefined;

  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    contaId = user.contaId;
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const agora = new Date();
    const mesAtual = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const proximoMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1);
    const startOfToday = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const endOfNext30Days = new Date(startOfToday);
    endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
    endOfNext30Days.setHours(23, 59, 59, 999);

    const loadBody = async () => {
      const localSnapshot = await getFinanceiroKpisLocal({
        contaId: user.contaId!,
        mesAtual,
        proximoMes,
        startOfToday,
        endOfNext30Days,
      });

      const totalPendentes = localSnapshot.data.aguardandoPagamento.quantidadeDeCobrancas;
      const totalAtrasados = localSnapshot.data.vencidas.quantidadeDeCobrancas;
      const totalPagos =
        localSnapshot.data.recebidas.quantidadeDeCobrancas +
        localSnapshot.data.recebidasEmDinheiro.quantidadeDeCobrancas +
        localSnapshot.data.confirmadas.quantidadeDeCobrancas;
      const somaPendentes = localSnapshot.data.aguardandoPagamento.valorBruto;
      const somaPagos =
        localSnapshot.data.recebidas.valorBruto +
        localSnapshot.data.recebidasEmDinheiro.valorBruto +
        localSnapshot.data.confirmadas.valorBruto;

      return financeiroIndicadoresResultDTOSchema.parse(mapFinanceiroIndicadoresResultToDTO({
        data: {
          cobrancas: {
            pendentes: totalPendentes,
            pagas: totalPagos,
            atrasadas: totalAtrasados,
            valorPendentes: somaPendentes,
            valorPagos: somaPagos,
          },
        },
      }));
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(
        await loadBody(),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildFinanceiroIndicadoresCacheKey(user.contaId),
      ttlSeconds: FINANCEIRO_INDICADORES_CACHE_SECONDS,
      staleWhileRevalidateSeconds: FINANCEIRO_INDICADORES_STALE_SECONDS,
      lockTtlSeconds: 8,
      waitForLockMs: 400,
      load: loadBody,
    });
    cacheState = cached.state;

    return privateJson(cached.body, {
      maxAgeSeconds: FINANCEIRO_INDICADORES_CACHE_SECONDS,
      staleWhileRevalidateSeconds: FINANCEIRO_INDICADORES_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (e) {
    return financeInternalError('API Financeiro Indicadores', e);
  } finally {
    logFinanceApiRequest('GET /api/financeiro/indicadores', {
      contaId,
      durationMs: Date.now() - startedAt,
      cacheHit: cacheState,
    });
  }
}
