import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listInstallmentPlansAggregated } from '@alusa/finance';
import type { InstallmentStatus } from '@prisma/client';
import {
  financeInstallmentAggregatedQueryDTOSchema,
  financeInstallmentAggregatedResultDTOSchema,
} from '@/features/finance/dtos';
import {
  mapFinanceInstallmentAggregatedItemToDTO,
  mapFinanceInstallmentAggregatedResultToDTO,
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
 * GET /api/finance/installments/aggregated
 * Lista parcelamentos agregados (Academic + Standalone) com status derivado.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { searchParams } = new URL(req.url);
    const parsedQuery = financeInstallmentAggregatedQueryDTOSchema.safeParse({
      page: Number(searchParams.get('page') ?? '1'),
      pageSize: Number(searchParams.get('pageSize') ?? '20'),
      q: searchParams.get('q')?.trim() || undefined,
      status: searchParams.get('status') || undefined,
    });
    if (!parsedQuery.success) {
      const issue = parsedQuery.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const { page, pageSize, q: search, status: statusRaw } = parsedQuery.data;
    const statusFilter =
      statusRaw && statusRaw !== 'all'
        ? (statusRaw.toUpperCase() as InstallmentStatus)
        : undefined;

    const result = await listInstallmentPlansAggregated({
      contaId: user.contaId,
      page,
      pageSize,
      search,
      statusFilter,
    });

    return NextResponse.json(
      financeInstallmentAggregatedResultDTOSchema.parse(
        mapFinanceInstallmentAggregatedResultToDTO({
          data: result.items.map((item) =>
            mapFinanceInstallmentAggregatedItemToDTO(item as unknown as Record<string, unknown>),
          ),
          meta: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.totalPages,
          },
        }),
      ),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Installments Aggregated] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
