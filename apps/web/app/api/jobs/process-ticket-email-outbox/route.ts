import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';

import { apiJsonError } from '@/lib/api/standard-response';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    const result = await drainFinanceWebhookSideEffectOutbox({
      contaId: tenantScope.contaId,
      limit: toPositiveInt(url.searchParams.get('limit'), 100, 500),
      effectTypes: ['EVENT_PUBLIC_ORDER_TICKET_EMAIL'],
    });

    logJobResult('process-ticket-email-outbox', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      partialFailure: result.failed > 0,
    });

    return NextResponse.json({
      success: result.failed === 0,
      job: result,
    });
  } catch (error) {
    logJobFailure('process-ticket-email-outbox', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar a fila de e-mails de ingressos.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
