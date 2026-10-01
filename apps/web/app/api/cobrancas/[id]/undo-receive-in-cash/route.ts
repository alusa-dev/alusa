import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { cobrancaRouteParamsDTOSchema } from '@/features/finance/operations/charges/dtos';
import { executeUndoCashPayment } from '@/src/server/finance/undo-cash-payment.service';

import { logFinanceApiError } from '@/lib/api/finance-api-response';
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);
    const response = await executeUndoCashPayment({
      contaId: auth.contaId,
      userId: auth.userId,
      role: auth.role,
      id,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    logFinanceApiError('/api/cobrancas/[id]/undo-receive-in-cash', error);
    return NextResponse.json(
      { error: 'Erro ao desfazer recebimento em dinheiro' },
      { status: 500 },
    );
  }
}
