import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  cobrancaRouteParamsDTOSchema,
  cobrancaUpdateFormaPagamentoInputDTOSchema,
  cobrancaUpdateFormaPagamentoResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaUpdateFormaPagamentoResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import { updateCobrancaFormaPagamento } from '@/src/server/finance/cobranca-forma-pagamento.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/** PUT /api/cobrancas/[id]/forma-pagamento */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);
    const parsedBody = cobrancaUpdateFormaPagamentoInputDTOSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: 'Forma de pagamento é obrigatória' },
        { status: 400 },
      );
    }

    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: 'Usuário não autenticado' }, { status: 401 });
    }
    if (!allowedRoles.has(String(auth.role ?? '').toUpperCase())) {
      return NextResponse.json(
        { success: false, error: 'Usuário sem permissão para alterar forma de pagamento' },
        { status: 403 },
      );
    }

    const result = await updateCobrancaFormaPagamento({
      id,
      contaId: auth.contaId,
      userId: auth.userId,
      formaPagamento: parsedBody.data.formaPagamento,
    });
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });

    return NextResponse.json(
      cobrancaUpdateFormaPagamentoResultDTOSchema.parse(
        mapCobrancaUpdateFormaPagamentoResultToDTO({
          success: true,
          message:
            'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
          data: result.data,
        }),
      ),
      { status: 202 },
    );
  } catch (error) {
    console.error('[PUT forma-pagamento] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar a forma de pagamento.' },
      { status: 500 },
    );
  }
}
