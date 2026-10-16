import { NextResponse } from 'next/server';

import { reconcileRefundingEventMapOrders } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('events-reconcile-refunds', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('events-reconcile-refunds');

    const result = await reconcileRefundingEventMapOrders({
      contaId: tenantScope.contaId,
      olderThanMinutes: toPositiveInt(url.searchParams.get('olderThanMinutes'), 5, 24 * 60),
      limit: toPositiveInt(url.searchParams.get('limit'), 50, 500),
      maxAccounts: toPositiveInt(url.searchParams.get('maxAccounts'), 20, 50),
    });

    logJobResult('events-reconcile-refunds', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      errorCount: result.errors.length,
      partialFailure: result.errors.length > 0,
      skippedDueToLock: Boolean(result.skippedDueToLock),
      unmatchedRefundCount: result.unmatched,
      workStatus: result.skippedDueToLock ? 'unknown' : result.processed > 0 ? 'worked' : result.errors.length > 0 ? 'unknown' : 'empty',
    });
    const { errors, ...safeJob } = result;
    return NextResponse.json(
      {
        success: errors.length === 0,
        outcome: errors.length > 0 ? 'partial' : 'completed',
        job: { ...safeJob, errorCount: errors.length },
      },
      { status: errors.length > 0 ? 503 : 200 },
    );
  } catch (error) {
    if (startedAt) logJobFailure('events-reconcile-refunds', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível reconciliar estornos de ingressos.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
