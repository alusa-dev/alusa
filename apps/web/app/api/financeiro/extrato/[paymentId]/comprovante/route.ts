import { NextRequest, NextResponse } from 'next/server';

import { getPayment, recordAsaasReadIntent } from '@alusa/finance';

import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { safeGetServerSession } from '@/lib/safe-server-session';

type SessUser = { id?: string; contaId?: string; role?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ paymentId: string }> },
) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const { paymentId } = await ctx.params;
    if (!paymentId?.trim()) return json(400, { error: 'PAYMENT_ID_INVALIDO' });

    recordAsaasReadIntent('AUTHORITATIVE_DOCUMENT');
    const payment = await getPayment(paymentId, { contaId: user.contaId });
    const receiptUrl = payment.transactionReceiptUrl ?? payment.invoiceUrl ?? null;

    if (!receiptUrl) {
      return json(404, { error: 'COMPROVANTE_NAO_DISPONIVEL' });
    }

    return NextResponse.redirect(receiptUrl, {
      status: 307,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('[API extrato comprovante][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
