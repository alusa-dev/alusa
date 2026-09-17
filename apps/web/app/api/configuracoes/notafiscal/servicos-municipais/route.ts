import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { municipalServicesQuerySchema } from '@/features/configuracoes/notafiscal/dtos';
import { listProviderMunicipalServices } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const parsed = municipalServicesQuerySchema.safeParse({
      description: request.nextUrl.searchParams.get('description') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const result = await listProviderMunicipalServices({
      contaId: auth.contaId,
      ...parsed.data,
    });
    if (!result.success) {
      const status =
        result.error === 'FISCAL_CORE_NOT_SYNCED'
          ? 412
          : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
            ? 503
            : 500;
      return json(status, {
        error: result.error,
        message:
          result.error === 'FISCAL_CORE_NOT_SYNCED'
            ? 'Salve emissor e informações fiscais antes de listar serviços municipais.'
            : undefined,
      });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal ServicosMunicipais][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
