import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { resolveChargeFromRouteRef } from '@/lib/finance/resolve-charge-route-ref';
import { cancelChargeInvoice } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function cancelInvoiceErrorBody(error: string | { kind: string; message: string }) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { error: 'ERRO_AO_CANCELAR_INVOICE', message: error.message };
  }

  const messages: Record<string, string> = {
    INVOICE_NAO_ENCONTRADA: 'Nota fiscal não encontrada para esta cobrança.',
    INVOICE_SEM_ID_ASAAS: 'Esta nota fiscal ainda não possui identificador no Asaas.',
    INVOICE_NAO_CANCELAVEL: 'Esta nota fiscal não está em um status que permite cancelamento.',
    INVOICE_CANCELAMENTO_NAO_SUPORTADO:
      'A prefeitura desta conta não permite cancelamento automático pela integração.',
    CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: 'Credenciais Asaas não configuradas para esta conta.',
    ERRO_AO_CANCELAR_INVOICE: 'Não foi possível cancelar a nota fiscal no Asaas.',
  };
  return { error, message: messages[error] ?? 'Não foi possível cancelar a nota fiscal.' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { id: routeRef } = await context.params;
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const resolved = await resolveChargeFromRouteRef(user.contaId, routeRef);
    if (!resolved) return json(404, { error: 'CHARGE_NAO_ENCONTRADA' });

    const result = await cancelChargeInvoice({
      contaId: user.contaId,
      chargeId: resolved.chargeId,
      cobrancaId: resolved.cobrancaId ?? undefined,
      actor: { type: 'USER', id: user.id },
    });

    if (!result.success) {
      const status =
        typeof result.error === 'object'
          ? 422
          : result.error === 'INVOICE_NAO_ENCONTRADA'
          ? 404
          : result.error === 'INVOICE_NAO_CANCELAVEL' ||
              result.error === 'INVOICE_CANCELAMENTO_NAO_SUPORTADO'
            ? 409
            : 500;
      return json(status, cancelInvoiceErrorBody(result.error));
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Cobranca NotaFiscal Cancelar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
