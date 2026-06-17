import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { listFiscalReferenceCodes } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const kindSchema = z.enum([
  'federalServiceCodes',
  'operationIndicatorCodes',
  'taxClassificationCodes',
  'taxSituationCodes',
]);
const querySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  code: z.string().optional(),
  description: z.string().optional(),
});

type SessionUser = { id?: string; role?: string; contaId?: string };
type RouteContext = { params: Promise<{ kind: string }> };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { kind: rawKind } = await context.params;
    const kind = kindSchema.safeParse(rawKind);
    if (!kind.success) return json(404, { error: 'REFERENCIA_FISCAL_INVALIDA' });

    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const parsed = querySchema.safeParse({
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      code: request.nextUrl.searchParams.get('code') ?? undefined,
      description: request.nextUrl.searchParams.get('description') ?? undefined,
    });
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const result = await listFiscalReferenceCodes({
      contaId: user.contaId,
      kind: kind.data,
      ...parsed.data,
    });

    if (!result.success) {
      return json(
        result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' ? 503 : 500,
        { error: result.error },
      );
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal Referencias][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
