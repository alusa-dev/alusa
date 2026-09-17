import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import { financeiroCobrancaCancelResultDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { mapFinanceiroCobrancaCancelResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import { cancelAcademicCobranca } from '@/src/server/finance/cobranca-cancellation.service';

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
 * DELETE /api/financeiro/cobrancas/[id]
 * Cancela uma cobrança e, se tiver asaasPaymentId, também cancela no Asaas
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuário não autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { id } = await params;

    const result = await cancelAcademicCobranca({
      contaId: auth.contaId,
      cobrancaId: id,
      actorId: auth.userId,
    });

    if (result.status === 'NOT_FOUND') return err(404, 'COBRANCA_NAO_ENCONTRADA', 'Cobrança não encontrada');

    if (result.status === 'ALREADY_CANCELED') {
      return NextResponse.json(
        financeiroCobrancaCancelResultDTOSchema.parse(mapFinanceiroCobrancaCancelResultToDTO({
          success: true,
          message: 'Cobrança já está cancelada',
        })),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (result.status === 'STATUS_BLOCKED') {
      return err(
        400,
        'STATUS_BLOQUEADO',
        `Não é possível cancelar cobrança com status ${result.cobrancaStatus}.`,
      );
    }

    return NextResponse.json(
      financeiroCobrancaCancelResultDTOSchema.parse(mapFinanceiroCobrancaCancelResultToDTO({
        success: true,
        message: result.status === 'CANCELED'
          ? 'Cobrança cancelada com sucesso'
          : 'Solicitação enviada. O status será atualizado automaticamente.',
      })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'DELETE /api/financeiro/cobrancas/[id]',
      fallbackMessage: 'Não foi possível cancelar a cobrança.',
    });
  }
}
