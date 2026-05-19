import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getInstallmentPlanDetail } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * GET /api/finance/installments/[id]
 * Retorna detalhes de um parcelamento (Academic ou Standalone).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
    const rawParams = await params;
  try {
    const session = await getServerSession(authOptions);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.id || !user?.contaId) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const detail = await getInstallmentPlanDetail({
      planId: rawParams.id,
      contaId: user.contaId,
    });

    if (!detail) {
      return err(404, 'NAO_ENCONTRADO', 'Parcelamento não encontrado');
    }

    return NextResponse.json(
      { data: detail },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Installment Detail] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
