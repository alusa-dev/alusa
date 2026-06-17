import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { syncFiscalSettingsFromProvider } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const result = await syncFiscalSettingsFromProvider({ contaId: user.contaId });
    if (!result.success) {
      return json(result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500, { error: result.error });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal Sincronizar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
