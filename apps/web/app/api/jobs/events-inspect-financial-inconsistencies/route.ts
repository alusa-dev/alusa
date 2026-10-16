import { NextResponse } from 'next/server';

import { inspectEventFinancialInconsistencies } from '@alusa/finance';

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
    const tenantScope = await resolveTenantScopeForJob('events-inspect-financial-inconsistencies', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('events-inspect-financial-inconsistencies');

    const result = await inspectEventFinancialInconsistencies({
      contaId: tenantScope.contaId,
      limit: toPositiveInt(url.searchParams.get('limit'), 200, 1000),
      maxAccounts: toPositiveInt(url.searchParams.get('maxAccounts'), 20, 50),
    });

    logJobResult(
      'events-inspect-financial-inconsistencies',
      startedAt,
      {
        inspected: result.inspected,
        findingCount: result.findings.length,
      },
      {
        hasTenantScope: Boolean(tenantScope.contaId),
        skippedDueToLock: Boolean(result.skippedDueToLock),
        workStatus: result.skippedDueToLock ? 'unknown' : result.findings.length > 0 ? 'worked' : 'empty',
      },
    );
    return NextResponse.json({
      success: true,
      outcome: 'completed',
      job: {
        inspected: result.inspected,
        findingCount: result.findings.length,
        generatedAt: result.generatedAt,
        ...(result.skippedDueToLock ? { skippedDueToLock: true } : {}),
      },
    });
  } catch (error) {
    if (startedAt) logJobFailure('events-inspect-financial-inconsistencies', startedAt, error);
    return apiJsonError(
      500,
      'JOB_FAILED',
      'Não foi possível inspecionar inconsistências financeiras.',
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
