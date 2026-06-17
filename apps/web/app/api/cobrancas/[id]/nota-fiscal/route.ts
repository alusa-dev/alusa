import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { resolveChargeFromRouteRef } from '@/lib/finance/resolve-charge-route-ref';
import {
  chargeInvoiceResponseSchema,
  scheduleChargeInvoiceInputSchema,
} from '@/features/configuracoes/notafiscal/dtos';
import {
  emitChargeInvoice,
  getChargeInvoiceDetail,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function scheduleInvoiceErrorStatus(error: string | { kind: string; message: string }): number {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return 422;
  }
  if (error === 'FEATURE_DISABLED') return 403;
  if (error === 'KYC_NAO_APROVADO' || error === 'FISCAL_NOT_READY' || error === 'CHARGE_SEM_PAGAMENTO_ASAAS') {
    return 409;
  }
  if (error === 'CHARGE_NAO_ENCONTRADO') return 404;
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return 503;
  return 500;
}

function scheduleInvoiceErrorBody(error: string | { kind: string; message: string }) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { error: 'ERRO_AO_AGENDAR_INVOICE', message: error.message };
  }
  return { error };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id: routeRef } = await context.params;
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const resolved = await resolveChargeFromRouteRef(user.contaId, routeRef);
    if (!resolved) return json(404, { error: 'CHARGE_NAO_ENCONTRADA' });

    const result = await getChargeInvoiceDetail({ contaId: user.contaId, routeRef });
    if (!result.success) {
      return json(result.error === 'CHARGE_NAO_ENCONTRADO' ? 404 : 500, { error: result.error });
    }

    const dto = chargeInvoiceResponseSchema.parse(result.data);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Cobranca NotaFiscal][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
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

    const raw = await req.json().catch(() => ({}));
    const parsed = scheduleChargeInvoiceInputSchema.safeParse(raw);
    if (!parsed.success) return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });

    const result = await emitChargeInvoice({
      contaId: user.contaId,
      chargeId: resolved.chargeId,
      actor: { type: 'USER', id: user.id },
      ...parsed.data,
    });

    if (!result.success) {
      return json(scheduleInvoiceErrorStatus(result.error), scheduleInvoiceErrorBody(result.error));
    }

    const dto = chargeInvoiceResponseSchema.parse(result.data);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Cobranca NotaFiscal][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
