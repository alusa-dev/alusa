import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
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
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuário não autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const detail = await getInstallmentPlanDetail({
      planId: rawParams.id,
      contaId: auth.contaId,
    });

    if (!detail) {
      return err(404, 'NAO_ENCONTRADO', 'Parcelamento não encontrado');
    }

    return NextResponse.json(
      { data: detail },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'GET /api/finance/installments/[id]',
      fallbackMessage: 'Não foi possível carregar o parcelamento.',
    });
  }
}
