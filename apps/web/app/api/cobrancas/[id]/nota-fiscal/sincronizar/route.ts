import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { resolveChargeFromRouteRef } from '@/lib/finance/resolve-charge-route-ref';
import { syncInvoiceFromProvider } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function syncInvoiceErrorStatus(error: string | { kind: string; message: string; status?: number }): number {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? 422 : 502;
  }
  if (error === 'INVOICE_NAO_ENCONTRADA') return 404;
  if (error === 'INVOICE_SEM_ID_ASAAS') return 409;
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return 503;
  return 500;
}

function syncInvoiceErrorBody(error: string | { kind: string; message: string; status?: number }) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { error: 'ERRO_AO_SINCRONIZAR_INVOICE', message: error.message };
  }
  if (error === 'INVOICE_SEM_ID_ASAAS') {
    return {
      error,
      message: 'Esta nota ainda não possui identificador no Asaas. Tente emitir novamente.',
    };
  }
  return { error };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { id: routeRef } = await context.params;
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const resolved = await resolveChargeFromRouteRef(user.contaId, routeRef);
    if (!resolved) return json(404, { error: 'CHARGE_NAO_ENCONTRADA' });

    const result = await syncInvoiceFromProvider({
      contaId: user.contaId,
      chargeId: resolved.chargeId,
      cobrancaId: resolved.cobrancaId ?? undefined,
    });

    if (!result.success) {
      return json(syncInvoiceErrorStatus(result.error), syncInvoiceErrorBody(result.error));
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Cobranca NotaFiscal Sincronizar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
