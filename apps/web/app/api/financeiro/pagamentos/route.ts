import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import { listFinanceiroPagamentosResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoRecordToDTO } from '@/features/financeiro/mappers';
import { financeInternalError, financeJsonError, stableQueryFingerprint } from '@/lib/api/finance-api-response';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import {
  buildTenantCacheKey,
  isCacheLayerEnabled,
  withTenantCache,
} from '@/lib/cache/tenant-cache';
import { buildChargeDisplayStatusDTO } from '@/lib/finance/charge-display-status';
import { privateJson } from '@/lib/private-cache';

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
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const status = url.searchParams.getAll('status');
    const formaPagamento = url.searchParams.getAll('formaPagamento');
    const cobrancaId = url.searchParams.get('cobrancaId') || undefined;
    const search = url.searchParams.get('q')?.trim();

    const where: Record<string, unknown> = {
      cobranca: { matricula: { aluno: { contaId: user.contaId } } },
    };
    if (status.length) where.status = { in: status };
    if (formaPagamento.length) where.formaPagamento = { in: formaPagamento } as { in: string[] };
    if (cobrancaId) where.cobrancaId = cobrancaId;
    if (search) {
      where.OR = [
        { cobranca: { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } } },
        { cobranca: { descricao: { contains: search, mode: 'insensitive' } } },
      ];
    }

    async function loadPagamentos() {
      return Promise.all([
        prisma.pagamento.count({ where }),
        prisma.pagamento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cobranca: {
            include: {
              matricula: { select: { aluno: { select: { id: true, nome: true } }, id: true } },
            },
          },
        },
        }),
      ]);
    }

    const loadBody = async () => {
      const [total, pagamentos] = await loadPagamentos();

      const items = pagamentos.map((p) => ({
        id: p.id,
        status: p.status,
        valorPago: Number(p.valorPago),
        dataPagamento: p.dataPagamento?.toISOString() || null,
        formaPagamento: p.formaPagamento,
        cobrancaId: p.cobrancaId,
        cobranca: {
          id: p.cobranca.id,
          tipo: p.cobranca.tipo,
          status: p.cobranca.status,
          valor: Number(p.cobranca.valor),
          vencimento: p.cobranca.vencimento.toISOString(),
          aluno: {
            id: p.cobranca.matricula.aluno.id,
            nome: p.cobranca.matricula.aluno.nome,
          },
          displayStatus: buildChargeDisplayStatusDTO({
            localStatus: p.cobranca.status,
            asaasStatus: p.cobranca.asaasStatus,
            liquidacaoStatus: p.cobranca.liquidacaoStatus,
            hasAsaasLink: Boolean(
              p.cobranca.asaasPaymentId || p.cobranca.asaasStatus || p.cobranca.liquidacaoStatus,
            ),
          }),
        },
        asaasPaymentId: p.asaasPaymentId,
        createdAt: p.createdAt.toISOString(),
      }));

      return listFinanceiroPagamentosResultDTOSchema.parse({
        data: items.map((item) => mapFinanceiroPagamentoRecordToDTO(item)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    };

    if (!isCacheLayerEnabled()) {
      return NextResponse.json(await loadBody(), { headers: { 'cache-control': 'no-store' } });
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildPagamentosCacheKey(user.contaId, {
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
