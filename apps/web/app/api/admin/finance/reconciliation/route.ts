import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  getFinanceReconciliationIssueSummary,
  listFinanceReconciliationIssues,
} from '@alusa/finance';
import type {
  FinanceReconciliationIssueSeverity,
  FinanceReconciliationIssueStatus,
  FinanceReconciliationIssueType,
} from '@prisma/client';

export const dynamic = 'force-dynamic';

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(req: Request) {
  const scope = await resolveTenantScope(req, { requireAdmin: true });
  if (!scope.ok) return scope.response;
  if (!scope.contaId) {
    return NextResponse.json({ error: { code: 'CONTA_OBRIGATORIA', message: 'Conta obrigatória.' } }, { status: 400 });
  }

  const url = new URL(req.url);
  const [issues, summary] = await Promise.all([
    listFinanceReconciliationIssues({
      contaId: scope.contaId,
      status: (url.searchParams.get('status') || 'OPEN') as FinanceReconciliationIssueStatus,
      severity: (url.searchParams.get('severity') || undefined) as FinanceReconciliationIssueSeverity | undefined,
      issueType: (url.searchParams.get('issueType') || undefined) as FinanceReconciliationIssueType | undefined,
      page: parsePositiveInt(url.searchParams.get('page'), 1, 1000),
      pageSize: parsePositiveInt(url.searchParams.get('pageSize'), 25, 100),
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
