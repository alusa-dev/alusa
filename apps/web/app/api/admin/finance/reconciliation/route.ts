import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  getFinanceReconciliationIssueSummary,
  listFinanceReconciliationIssues,
} from '@alusa/finance';
import { financeReconciliationQueryDTOSchema } from '@/features/finance/dtos';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const scope = await resolveTenantScope(req, { requireAdmin: true });
  if (!scope.ok) return scope.response;
  if (!scope.contaId) {
    return NextResponse.json({ error: { code: 'CONTA_OBRIGATORIA', message: 'Conta obrigatória.' } }, { status: 400 });
  }

  const url = new URL(req.url);
  const query = financeReconciliationQueryDTOSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: { code: 'PARAMETROS_INVALIDOS', message: 'Parâmetros de reconciliação inválidos.', details: query.error.flatten() } },
      { status: 400 },
    );
  }
  const [issues, summary] = await Promise.all([
    listFinanceReconciliationIssues({
      contaId: scope.contaId,
      status: query.data.status,
      severity: query.data.severity,
      issueType: query.data.issueType,
      page: query.data.page,
      pageSize: query.data.pageSize,
    }),
    getFinanceReconciliationIssueSummary(scope.contaId),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      summary,
      issues,
    },
  });
}
