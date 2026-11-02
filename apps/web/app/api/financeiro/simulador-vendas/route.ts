import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  paymentSimulationInputDTOSchema,
  simulatePaymentFees,
} from '@alusa/finance';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { NextResponse } from 'next/server';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function requireSalesSimulatorUser() {
  const session = await safeGetServerSession();
  const user = (session as { user?: { id?: string; contaId?: string; role?: string; financeIntegrationMode?: string | null } } | null)?.user;

  if (!user?.id || !user.contaId) return { ok: false as const, response: json(401, { error: 'NAO_AUTENTICADO' }) };
  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
    return { ok: false as const, response: json(403, { error: 'SEM_PERMISSAO' }) };
  }

  // External accounts use the connected account's own Asaas credentials. The
  // whitelabel KYC gate is specific to anticipation/treasury capabilities.
  if (user.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return { ok: false as const, response: gate.response };
  }

  return { ok: true as const, user: { id: user.id, contaId: user.contaId, role: user.role } };
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function errorResponse(error: string) {
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') {
    return json(503, { error });
  }
  if (error === 'RESULTADO_ASAAS_INVALIDO') {
    return json(502, { error });
  }
  return json(502, { error: 'ERRO_ASAAS' });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSalesSimulatorUser();
    if (!auth.ok) return auth.response;

    const input = paymentSimulationInputDTOSchema.parse(await req.json());
    const result = await simulatePaymentFees({
      contaId: auth.user.contaId,
      input,
    });

    if (!result.success) return errorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }

    logFinanceApiError('/api/financeiro/simulador-vendas', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
