import { NextResponse } from 'next/server';

import { reconcilePendingEventMapTicketFulfillment } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await reconcilePendingEventMapTicketFulfillment({
      contaId: tenantScope.contaId,
      limit: toPositiveInt(url.searchParams.get('limit'), 100, 500),
      maxAccounts: toPositiveInt(url.searchParams.get('maxAccounts'), 20, 50),
      maxAttempts: toPositiveInt(url.searchParams.get('maxAttempts'), 10, 50),
    });

    logJobResult('events-fulfill-tickets', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      partialFailure: result.errors.length > 0,
      skippedDueToLock: Boolean(result.skippedDueToLock),
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
    logJobFailure('events-fulfill-tickets', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar a emissão de ingressos.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
