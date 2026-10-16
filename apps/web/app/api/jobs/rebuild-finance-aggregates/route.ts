import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { rebuildFinanceAggregates } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('rebuild-finance-aggregates', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('rebuild-finance-aggregates');

    const result = await rebuildFinanceAggregates({
      contaId: tenantScope.contaId,
      days: clampPositiveInt(url.searchParams.get('days'), 90, 370),
      maxAccounts: clampPositiveInt(url.searchParams.get('maxAccounts'), 50, 200),
      startDate: parseDate(url.searchParams.get('startDate')),
      endDate: parseDate(url.searchParams.get('endDate')),
    });
    logJobResult('rebuild-finance-aggregates', startedAt, {
      accounts: result.accounts,
      transactionsScanned: result.transactionsScanned,
      dailyAggregates: result.dailyAggregates,
      monthlyAggregates: result.monthlyAggregates,
    }, { workStatus: result.transactionsScanned > 0 ? 'worked' : 'empty' });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (startedAt) logJobFailure('rebuild-finance-aggregates', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconstruir os agregados financeiros.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
