import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { mapFinanceiroPagamentoPessoaHistoricoResultToDTO } from '@/features/financeiro/mappers';
import { buildPersonPaymentLedger } from '@/src/server/finance/person-payment-ledger';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ responsavelId: string }> },
) {
  try {
    const session = await safeGetServerSession();
    const user = (
      session as { user?: { id?: string; contaId?: string; role?: string } } | null
    )?.user;
    if (!user?.id || !user?.contaId) {
      return NextResponse.json(
        { success: false, error: { message: 'Usuário não autenticado' } },
        { status: 401 },
      );
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: { message: 'Acesso negado' } },
        { status: 403 },
      );
    }

    const { responsavelId } = await params;
    if (!responsavelId) {
      return NextResponse.json(
        { success: false, error: { message: 'ID do responsável é obrigatório' } },
        { status: 400 },
      );
    }

    const ledger = await buildPersonPaymentLedger({
      contaId: user.contaId,
      personType: 'RESPONSAVEL',
      personId: responsavelId,
    });

    if (!ledger) {
      return NextResponse.json(
        { success: false, error: { message: 'Responsável não encontrado' } },
        { status: 404 },
      );
    }

    return NextResponse.json(
      mapFinanceiroPagamentoPessoaHistoricoResultToDTO({
        success: true,
        data: {
          pessoa: ledger.pessoa,
          cobrancas: ledger.cobrancas,
          resumo: ledger.resumo,
        },
      }),
    );
  } catch (error) {
    console.error('[GET /api/financeiro/pagamentos/responsavel/[responsavelId]]', error);
    return NextResponse.json(
      {
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao buscar dados' },
      },
      { status: 500 },
    );
  }
}
