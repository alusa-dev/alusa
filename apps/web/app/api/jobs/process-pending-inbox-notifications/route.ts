import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processPendingInboxNotifications } from '@alusa/lib/notifications/pending-inbox-notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET|POST /api/jobs/process-pending-inbox-notifications
 *
 * Reprocessa notificações internas enfileiradas (ex.: webhook antes da entidade local).
 */
async function runProcessPendingInboxNotifications(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('process-pending-inbox-notifications', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('process-pending-inbox-notifications');

    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    const result = await processPendingInboxNotifications({
      contaId: tenantScope.contaId ?? undefined,
      limit,
    });
    logJobResult('process-pending-inbox-notifications', startedAt, {
      attempted: result.attempted,
      processed: result.processed,
      failed: result.failed,
    }, {
      partialFailure: result.failed > 0,
      workStatus: result.attempted > 0 ? 'worked' : result.failed > 0 ? 'unknown' : 'empty',
    });

    return NextResponse.json({
      success: result.failed === 0,
      outcome: result.failed > 0 ? 'partial' : 'completed',
      ...result,
    });
  } catch (error) {
    if (startedAt) logJobFailure('process-pending-inbox-notifications', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível processar a fila de notificações.');
  }
}

export async function GET(req: Request) {
  return runProcessPendingInboxNotifications(req);
}

export async function POST(req: Request) {
  return runProcessPendingInboxNotifications(req);
}
