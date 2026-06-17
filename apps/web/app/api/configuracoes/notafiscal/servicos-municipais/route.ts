import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { municipalServicesQuerySchema } from '@/features/configuracoes/notafiscal/dtos';
import { listProviderMunicipalServices } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
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
      contaId: user.contaId,
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
