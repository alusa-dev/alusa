import { NextResponse } from 'next/server';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { runWebhookHealthAndDriftMaintenance } from '@alusa/finance';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/jobs/webhook-maintenance
 *
 * Job de baixa frequência separado do drain da fila.
 * Executa health check remoto e drift check. A reativação de fila penalizada
 * exige o opt-in administrativo explícito `autoRepair=true`.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('webhook-maintenance', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireAdmin: true,
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('webhook-maintenance');

    const autoRepair = url.searchParams.get('autoRepair') === 'true';
    const result = await runWebhookHealthAndDriftMaintenance({
      contaId: tenantScope.contaId,
      autoRepair,
    });

    const failed = result.errors.length + result.health.errors.length + result.health.recoveryFailed;
    logJobResult('webhook-maintenance', startedAt, {
      accountsChecked: result.accountsChecked,
      driftsFound: result.driftsFound,
      driftsRepaired: result.driftsRepaired,
      checkedAccounts: result.health.checkedAccounts,
      recovered: result.health.recoveredSuccessfully,
      failed,
    }, {
      autoRepair,
      skippedDueToLock: result.skippedDueToLock === true,
      partialFailure: failed > 0,
      workStatus: result.driftsFound + result.health.recoveredSuccessfully > 0
        ? 'worked'
        : failed > 0 ? 'unknown' : 'empty',
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (startedAt) logJobFailure('webhook-maintenance', startedAt, error);
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.webhook.maintenance.failed',
      route: '/api/jobs/webhook-maintenance',
      method: req.method,
      requestId: getRequestId(req),
      error,
    });
    return NextResponse.json(
      { error: { code: 'WEBHOOK_MAINTENANCE_ERROR', message: 'Erro na manutenção de webhooks.' } },
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
