import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { getExtrato, extratoQueryInputSchema } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const query = extratoQueryInputSchema.parse({
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      type: searchParams.get('type') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      direction: searchParams.get('direction') ?? undefined,
    });

    const result = await getExtrato({
      contaId: auth.contaId,
      query,
    });

    if (!result.success) {
      const status = result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500;
      return json(status, { error: result.error });
    }

    return json(200, result.data);
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'QUERY_INVALIDA', details: error.flatten() });
    }
    console.error('[API extrato][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
