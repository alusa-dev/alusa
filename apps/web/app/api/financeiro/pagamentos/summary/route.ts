import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import {
  listFinanceiroPagamentoPessoaIndexResultDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoPessoaIndexItemToDTO } from '@/features/financeiro/mappers';
import { listPersonPaymentLedgerIndex } from '@/src/server/finance/person-payment-ledger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

// GET /api/financeiro/pagamentos/summary
// Retorna o índice financeiro local por pessoa (aluno e responsável).
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const search = url.searchParams.get('q')?.trim() || undefined;
    const statusFilters = url.searchParams.getAll('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));

    const result = await listPersonPaymentLedgerIndex({
      contaId: user.contaId,
      search,
      statusFilters,
      page,
      pageSize,
    });

    return NextResponse.json(
      listFinanceiroPagamentoPessoaIndexResultDTOSchema.parse({
        ...result,
        data: result.data.map((item) => mapFinanceiroPagamentoPessoaIndexItemToDTO(item)),
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro Pagamentos Summary] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
