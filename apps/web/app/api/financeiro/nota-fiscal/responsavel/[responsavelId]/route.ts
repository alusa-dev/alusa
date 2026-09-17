import { NextRequest, NextResponse } from 'next/server';

import {
  notaFiscalPersonDetailQueryDTOSchema,
  notaFiscalResponsavelRouteParamsDTOSchema,
} from '@/features/financeiro/notafiscal/dtos';
import { mapNotaFiscalPessoaDetalheResultToDTO } from '@/features/financeiro/notafiscal/mappers';
import { financeInternalError, financeJsonError } from '@/lib/api/finance-api-response';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getFiscalInvoicePersonDetail } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return financeJsonError(status, code, message);
}

type RouteContext = { params: Promise<{ responsavelId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const parsedParams = notaFiscalResponsavelRouteParamsDTOSchema.safeParse(await context.params);
    if (!parsedParams.success) return err(400, 'PARAMETROS_INVALIDOS', 'Responsável inválido');
    const url = new URL(req.url);
    const query = notaFiscalPersonDetailQueryDTOSchema.parse({
      status: url.searchParams.getAll('status'),
      effectiveDateFrom: url.searchParams.get('effectiveDateFrom'),
      effectiveDateTo: url.searchParams.get('effectiveDateTo'),
    });
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuário não autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const result = await getFiscalInvoicePersonDetail({
      contaId: auth.contaId,
      personType: 'RESPONSAVEL',
      personId: parsedParams.data.responsavelId,
      statusFilters: query.status.length ? query.status : undefined,
      effectiveDateFrom: query.effectiveDateFrom,
      effectiveDateTo: query.effectiveDateTo,
    });

    if (!result.success) {
      return err(404, 'PESSOA_NAO_ENCONTRADA', 'Responsável não encontrado');
    }

    return NextResponse.json(mapNotaFiscalPessoaDetalheResultToDTO({ data: result.data }), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return financeInternalError('API Financeiro Nota Fiscal Responsavel', error);
  }
}
