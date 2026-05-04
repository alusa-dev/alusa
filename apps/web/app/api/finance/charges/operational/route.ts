import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { listOperationalCharges } from '@alusa/finance';
import { withPerfTimer } from '@/lib/perf-logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * GET /api/finance/charges/operational
 *
 * Fila operacional: retorna apenas cobranças que exigem atenção AGORA.
 * - Status: PENDING / OVERDUE
 * - Vencidas / mês corrente sempre entram
 * - Assinatura: sempre expõe a próxima cobrança aberta gerada
 * - Avulsas recentes entram sem abrir histórico futuro
 * - Parcelamentos: somente parcelas vencidas e da competência vigente
 * - Pagas/canceladas não aparecem
 *
 * Query params:
 *   - page (default: 1)
 *   - pageSize (default: 20, max: 100)
 *   - q (busca por nome do pagador ou descrição)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !ALLOWED_ROLES.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const search = url.searchParams.get('q')?.trim() || undefined;

    const result = await withPerfTimer(
      'finance',
      'listOperationalCharges',
      () => listOperationalCharges({
        contaId: user.contaId!,
        page,
        pageSize,
        search,
      }),
      { contaId: user.contaId }
    );

    return NextResponse.json(
      {
        data: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API finance/charges/operational] Erro:', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
