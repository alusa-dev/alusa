import { NextResponse } from 'next/server';

import { safeGetServerSession } from '@/lib/safe-server-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { getAccountOverview } from '@alusa/finance';

type SessUser = { id?: string; contaId?: string; role?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const result = await getAccountOverview({ contaId: user.contaId });
    if (!result.success) {
      const status = result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500;
      return json(status, { error: result.error });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[API conta][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;