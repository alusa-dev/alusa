import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { configureFiscalNationalPortal } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const inputSchema = z.object({ enabled: z.boolean() });

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const result = await configureFiscalNationalPortal({
      contaId: user.contaId,
      enabled: parsed.data.enabled,
    });

    if (!result.success) {
      return json(
        result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500,
        { error: result.error },
      );
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal PortalNacional][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
