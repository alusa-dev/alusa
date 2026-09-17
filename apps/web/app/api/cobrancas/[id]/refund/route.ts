import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  cobrancaRefundInputDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { executeCobrancaRefund } from '@/src/server/finance/refund-cobranca.service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 });
    if (!auth.role || !['ADMIN', 'FINANCEIRO'].includes(auth.role.toUpperCase())) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);
    const body = cobrancaRefundInputDTOSchema.parse(await req.json().catch(() => ({})));
    const response = await executeCobrancaRefund({
      contaId: auth.contaId,
      userId: auth.userId,
      role: auth.role,
      id,
      body,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    console.error('[API][cobrancas/refund] Erro:', error);
    return NextResponse.json(
      { error: 'Erro ao estornar cobrança' },
      { status: 500 },
    );
  }
}
