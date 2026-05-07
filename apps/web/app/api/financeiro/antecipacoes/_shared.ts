import { NextResponse } from 'next/server';

import { safeGetServerSession } from '@/lib/safe-server-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import type { AnticipationError } from '@alusa/finance';

type SessUser = { id?: string; contaId?: string; role?: string };
type FinanceUser = { id: string; contaId: string; role: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export function json(status: number, body: unknown, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

export function anticipationErrorResponse(error: AnticipationError) {
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') {
    return json(503, { error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });
  }
  if (error === 'ALVO_INVALIDO') {
    return json(422, { error: 'ALVO_INVALIDO' });
  }
  if (error === 'ANTECIPACAO_AUTOMATICA_EXIGE_PJ') {
    return json(409, {
      error: 'ANTECIPACAO_AUTOMATICA_EXIGE_PJ',
      message: 'A antecipação automática está disponível apenas para contas PJ no Asaas.',
    });
  }
  return json(502, { error: 'ERRO_ASAAS' });
}

export async function requireFinanceUser(
  opts: { checkAccountGate?: boolean } = {},
): Promise<
  | { ok: true; user: FinanceUser }
  | { ok: false; response: NextResponse }
> {
  const session = await safeGetServerSession();
  const user = (session as { user?: SessUser } | null)?.user;

  if (!user?.id || !user.contaId) {
    return { ok: false as const, response: json(401, { error: 'NAO_AUTENTICADO' }) };
  }

  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
    return { ok: false as const, response: json(403, { error: 'SEM_PERMISSAO' }) };
  }

  if (opts.checkAccountGate ?? true) {
    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) {
      return { ok: false as const, response: gate.response };
    }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      contaId: user.contaId,
      role: user.role,
    },
  };
}
