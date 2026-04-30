import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listSubscriptionsForFinance } from '@alusa/finance';
import type { SubscriptionStatus } from '@prisma/client';
import {
  financeSubscriptionEnrichedQueryDTOSchema,
  financeSubscriptionEnrichedResultDTOSchema,
} from '@/features/finance/dtos';
import {
  mapFinanceSubscriptionEnrichedItemToDTO,
  mapFinanceSubscriptionEnrichedResultToDTO,
} from '@/features/finance/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id: string; contaId: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * GET /api/finance/subscriptions/enriched
 * Lista assinaturas com dados enriquecidos para painel financeiro.
 * Delegação canônica para listSubscriptionsForFinance.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { searchParams } = new URL(req.url);
    const parsedQuery = financeSubscriptionEnrichedQueryDTOSchema.safeParse({
      page: Number(searchParams.get('page') ?? '1'),
      pageSize: Number(searchParams.get('pageSize') ?? '20'),
      search: searchParams.get('search')?.trim() || undefined,
      status: searchParams.get('status') || undefined,
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { page, pageSize, search, status: statusFilterRaw } = parsedQuery.data;
    const statusFilter = statusFilterRaw as SubscriptionStatus | undefined;

    const result = await listSubscriptionsForFinance({
      contaId: user.contaId,
      page,
      pageSize,
      status: statusFilter || undefined,
      search,
    });

    return NextResponse.json(
      financeSubscriptionEnrichedResultDTOSchema.parse(
        mapFinanceSubscriptionEnrichedResultToDTO({
          data: result.items.map((item) =>
            mapFinanceSubscriptionEnrichedItemToDTO(item as unknown as Record<string, unknown>),
          ),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
        }),
      ),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Subscriptions Enriched] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
