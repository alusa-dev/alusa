import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  FinancialReportRowLimitError,
  financialReportQuerySchema,
  type FinancialReportQuery,
} from '@alusa/finance';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

type SessionUser = { id?: string; contaId?: string; role?: string };
const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

export type FinancialReportRouteContext = {
  contaId: string;
  userId: string;
  tx: TenantTransactionClient;
};

export function financialReportJson(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: {
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
    },
  });
}

export async function resolveFinancialReportSession() {
  const session = await safeGetServerSession();
  const user = (session as { user?: SessionUser } | null)?.user;
  if (!user?.id || !user?.contaId) {
    return { ok: false as const, response: financialReportJson(401, { error: 'NAO_AUTENTICADO' }) };
  }
  if (!user.role || !ALLOWED_ROLES.has(user.role.toUpperCase())) {
    return { ok: false as const, response: financialReportJson(403, { error: 'SEM_PERMISSAO' }) };
  }
  return {
    ok: true as const,
    userId: user.id,
    contaId: user.contaId,
  };
}

export function parseFinancialReportQuery(
  request: NextRequest,
  overrides: Partial<FinancialReportQuery> = {},
): FinancialReportQuery {
  const params = request.nextUrl.searchParams;
  return financialReportQuerySchema.parse({
    startDate: params.get('startDate') ?? undefined,
    endDate: params.get('endDate') ?? undefined,
    dateBasis: params.get('dateBasis') ?? overrides.dateBasis ?? 'DUE_DATE',
    turmaId: params.get('turmaId') ?? undefined,
    planoId: params.get('planoId') ?? undefined,
    chargeType: params.get('chargeType') ?? undefined,
    paymentMethod: params.get('paymentMethod') ?? undefined,
    status: params.get('status') ?? overrides.status ?? undefined,
    origin: params.get('origin') ?? undefined,
    search: params.get('search') ?? '',
    page: params.get('page') ?? 1,
    pageSize: params.get('pageSize') ?? 20,
    sort: params.get('sort') ?? overrides.sort ?? 'dueDate',
    direction: params.get('direction') ?? 'desc',
  });
}

export async function runFinancialReportRoute(
  handler: (_context: FinancialReportRouteContext) => Promise<NextResponse>,
) {
  const auth = await resolveFinancialReportSession();
  if (!auth.ok) return auth.response;
  return runWithTenant(auth.contaId, (tx) =>
    handler({ contaId: auth.contaId, userId: auth.userId, tx }),
  );
}

export function handleFinancialReportError(error: unknown, label: string) {
  if (error instanceof FinancialReportRowLimitError) {
    return financialReportJson(413, {
      error: 'RELATORIO_MUITO_GRANDE',
      limit: error.limit,
    });
  }
  if (error instanceof ZodError) {
    return financialReportJson(422, {
      error: 'FILTROS_INVALIDOS',
      details: error.flatten(),
    });
  }
  console.error(`[API relatórios financeiros][${label}]`, error);
  return financialReportJson(500, { error: 'ERRO_INTERNO' });
}
