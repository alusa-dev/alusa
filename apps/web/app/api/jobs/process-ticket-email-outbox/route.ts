import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';

import { apiJsonError } from '@/lib/api/standard-response';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;

  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('process-ticket-email-outbox', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('process-ticket-email-outbox');

    const result = await drainFinanceWebhookSideEffectOutbox({
      contaId: tenantScope.contaId,
      limit: toPositiveInt(url.searchParams.get('limit'), 100, 500),
      effectTypes: ['EVENT_PUBLIC_ORDER_TICKET_EMAIL'],
    });

    logJobResult('process-ticket-email-outbox', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      partialFailure: result.failed > 0,
      workStatus: result.attempted > 0 ? 'worked' : result.failed > 0 ? 'unknown' : 'empty',
    });

    return NextResponse.json(
      {
        success: result.failed === 0,
        outcome: result.failed > 0 ? 'partial' : 'completed',
        job: result,
      },
      { status: result.failed > 0 ? 503 : 200 },
    );
  } catch (error) {
    if (startedAt) logJobFailure('process-ticket-email-outbox', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar a fila de e-mails de ingressos.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
