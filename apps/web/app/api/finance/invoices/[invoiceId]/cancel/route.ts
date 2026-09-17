import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { cancelInvoice } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const invoiceId = ctxParams.invoiceId;
    if (!invoiceId) return json(400, { error: 'INVOICE_ID_OBRIGATORIO' });

    const result = await cancelInvoice({
      contaId: auth.contaId,
      invoiceId,
      actor: { type: 'USER', id: auth.userId },
    });

    if (!result.success) {
      const status =
        result.error === 'FEATURE_DISABLED'
          ? 403
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
          : result.error === 'INVOICE_NAO_ENCONTRADA'
            ? 404
            : result.error === 'INVOICE_SEM_ID_ASAAS'
              ? 409
              : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
                ? 503
                : 500;

      return json(status, { error: result.error });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Finance Invoices Cancel][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
