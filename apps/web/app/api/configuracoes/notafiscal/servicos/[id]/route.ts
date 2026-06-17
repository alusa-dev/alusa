import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { fiscalServiceInputSchema } from '@/features/configuracoes/notafiscal/dtos';
import { deleteFiscalService, updateFiscalService } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function fiscalServiceErrorMessage(error: string): string | undefined {
  if (error === 'SERVICO_MUNICIPAL_INVALIDO') {
    return 'Selecione um serviço municipal da lista ou informe um código manual válido.';
  }
  if (error === 'PIS_COFINS_INVALIDO') {
    return 'Revise a situação tributária e as alíquotas de PIS/COFINS conforme as regras do Portal Nacional.';
  }
  return undefined;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const parsed = fiscalServiceInputSchema.safeParse(await request.json());
    if (!parsed.success) return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });

    const result = await updateFiscalService(user.contaId, id, parsed.data);
    if (!result.success) {
      const status =
        result.error === 'SERVICO_NAO_ENCONTRADO'
          ? 404
          : result.error === 'SERVICO_MUNICIPAL_INVALIDO' ||
              result.error === 'PIS_COFINS_INVALIDO'
            ? 422
            : 500;
      return json(status, { error: result.error, message: fiscalServiceErrorMessage(result.error) });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal Servicos][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const result = await deleteFiscalService(user.contaId, id);
    if (!result.success) {
      return json(result.error === 'SERVICO_NAO_ENCONTRADO' ? 404 : 500, { error: result.error });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal Servicos][DELETE]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
