import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { platformBillingAccessResponseForConta } from '@/src/server/platform-billing/capacity';
import {
  cobrancaRefundInputDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/finance/operations/charges/dtos';
import { executeCobrancaRefund } from '@/src/server/finance/refund-charge.service';

import { logFinanceApiError } from '@/lib/api/finance-api-response';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 });
    if (!auth.role || !['ADMIN', 'FINANCEIRO'].includes(auth.role.toUpperCase())) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }
    const billingBlocked = await platformBillingAccessResponseForConta({ contaId: auth.contaId, capability: 'FINANCIAL_CORRECTION' });
    if (billingBlocked) return NextResponse.json(billingBlocked.body, { status: billingBlocked.status });

    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);
    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    const refundGatewayEnabled = process.env.ASAAS_REFUND_GATEWAY_ENABLED === 'true';
    if ((idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) || (refundGatewayEnabled && !idempotencyKey)) {
      return NextResponse.json({ error: 'Cabeçalho Idempotency-Key obrigatório ou inválido.' }, { status: 400 });
    }
    const body = cobrancaRefundInputDTOSchema.parse(await req.json().catch(() => ({})));
    const response = await executeCobrancaRefund({
      contaId: auth.contaId,
      userId: auth.userId,
      role: auth.role,
      id,
      correlationId: idempotencyKey,
      body,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    logFinanceApiError('/api/cobrancas/[id]/refund', error);
    return NextResponse.json(
      { error: 'Erro ao estornar cobrança' },
      { status: 500 },
    );
  }
}
