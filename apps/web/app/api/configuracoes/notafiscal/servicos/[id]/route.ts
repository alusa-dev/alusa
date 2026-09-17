import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { fiscalServiceInputSchema } from '@/features/configuracoes/notafiscal/dtos';
import { deleteFiscalService, updateFiscalService } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

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
  if (error === 'IBS_CBS_INVALIDO') {
    return 'Preencha NBS, código nacional do serviço, situação tributária, classificação tributária e indicador de operação para emitir com IBS/CBS.';
  }
  return undefined;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const parsed = fiscalServiceInputSchema.safeParse(await request.json());
    if (!parsed.success) return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });

    const result = await updateFiscalService(auth.contaId, id, parsed.data);
    if (!result.success) {
      const status =
        result.error === 'SERVICO_NAO_ENCONTRADO'
          ? 404
          : result.error === 'SERVICO_MUNICIPAL_INVALIDO' ||
              result.error === 'PIS_COFINS_INVALIDO'
              || result.error === 'IBS_CBS_INVALIDO'
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
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const result = await deleteFiscalService(auth.contaId, id);
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
