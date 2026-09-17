import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { configureFiscalNationalPortal } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const inputSchema = z.object({ enabled: z.boolean() });

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const result = await configureFiscalNationalPortal({
      contaId: auth.contaId,
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
