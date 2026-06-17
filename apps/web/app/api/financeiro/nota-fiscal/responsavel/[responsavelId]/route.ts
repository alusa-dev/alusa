import type { InvoiceStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { mapNotaFiscalPessoaDetalheResultToDTO } from '@/features/financeiro/notafiscal/mappers';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { getFiscalInvoicePersonDetail } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const allowedStatuses = new Set<InvoiceStatus>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
]);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseStatusFilters(values: string[]): InvoiceStatus[] {
  return values
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is InvoiceStatus => allowedStatuses.has(value as InvoiceStatus));
}

function parseDetailQuery(req: NextRequest) {
  const url = new URL(req.url);
  return {
    statusFilters: parseStatusFilters(url.searchParams.getAll('status')),
    effectiveDateFrom: url.searchParams.get('effectiveDateFrom')?.trim() || undefined,
    effectiveDateTo: url.searchParams.get('effectiveDateTo')?.trim() || undefined,
  };
}

type RouteContext = { params: Promise<{ responsavelId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { responsavelId } = await context.params;
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const query = parseDetailQuery(req);
    const result = await getFiscalInvoicePersonDetail({
      contaId: user.contaId,
      personType: 'RESPONSAVEL',
      personId: responsavelId,
      statusFilters: query.statusFilters.length ? query.statusFilters : undefined,
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
    console.error('[API Financeiro Nota Fiscal Responsavel]', error);
    return err(500, 'ERRO_INTERNO', (error as Error).message);
  }
}
