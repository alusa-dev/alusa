import type { InvoiceStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { listNotaFiscalPersonIndexResultDTOSchema } from '@/features/financeiro/notafiscal/dtos';
import { mapListNotaFiscalPersonIndexResultToDTO } from '@/features/financeiro/notafiscal/mappers';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { listFiscalInvoicePersonIndex } from '@alusa/finance';

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

export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const url = new URL(req.url);
    const search = url.searchParams.get('q')?.trim() || undefined;
    const statusFilters = parseStatusFilters(url.searchParams.getAll('status'));
    const effectiveDateFrom = url.searchParams.get('effectiveDateFrom')?.trim() || undefined;
    const effectiveDateTo = url.searchParams.get('effectiveDateTo')?.trim() || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));

    const result = await listFiscalInvoicePersonIndex({
      contaId: user.contaId,
      search,
      statusFilters: statusFilters.length ? statusFilters : undefined,
      effectiveDateFrom,
      effectiveDateTo,
      page,
      pageSize,
    });

    return NextResponse.json(
      listNotaFiscalPersonIndexResultDTOSchema.parse(mapListNotaFiscalPersonIndexResultToDTO(result)),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[API Financeiro Nota Fiscal Summary]', error);
    return err(500, 'ERRO_INTERNO', (error as Error).message);
  }
}
