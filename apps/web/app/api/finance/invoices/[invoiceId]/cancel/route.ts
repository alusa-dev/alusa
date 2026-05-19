import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { cancelInvoice } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const invoiceId = ctxParams.invoiceId;
    if (!invoiceId) return json(400, { error: 'INVOICE_ID_OBRIGATORIO' });

    const result = await cancelInvoice({
      contaId: user.contaId,
      invoiceId,
      actor: { type: 'USER', id: user.id },
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
