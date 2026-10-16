import { NextResponse } from 'next/server';
import { processAsaasNotificationSyncOutbox } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

/**
 * GET/POST /api/jobs/process-asaas-notification-sync
 *
 * Reprocessa apenas sincronizações explícitas de canais enfileiradas pelo
 * fluxo de cobrança. Não cria, cancela ou altera pagamentos.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('process-asaas-notification-sync', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('process-asaas-notification-sync');

    const result = await processAsaasNotificationSyncOutbox({
      contaId: tenantScope.contaId,
      limit: clampPositiveInt(url.searchParams.get('limit'), 25, 100),
      maxAttempts: clampPositiveInt(url.searchParams.get('maxAttempts'), 8, 20),
    });

    logJobResult('process-asaas-notification-sync', startedAt, result, {
      partialFailure: result.failed > 0 || result.exhausted > 0,
      workStatus: result.processed + result.failed + result.exhausted > 0
        ? 'worked'
        : result.scanned === 0 && result.failed === 0 && result.exhausted === 0 && result.partial === 0
          ? 'empty'
          : 'unknown',
    });
    return NextResponse.json({
      success: result.failed === 0 && result.exhausted === 0,
      outcome: result.failed > 0 || result.exhausted > 0 ? 'partial' : 'completed',
      result,
    });
  } catch (error) {
    if (startedAt) logJobFailure('process-asaas-notification-sync', startedAt, error);
    return NextResponse.json(
      { error: { code: 'ERRO_JOB', message: 'Não foi possível processar a fila de notificações.' } },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
