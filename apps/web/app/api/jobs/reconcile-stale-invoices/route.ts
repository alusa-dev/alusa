import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { reconcileStaleInvoices } from '@alusa/finance';
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

/**
 * GET/POST /api/jobs/reconcile-stale-invoices
 *
 * Reconsulta o Asaas para notas fiscais antigas em status SCHEDULED/SYNCHRONIZED/ERROR.
 *
 * Query params:
 * - contaId (opcional): restringe para uma conta, validada contra sessão ou cron token.
 * - limit (opcional): limite de notas, default 50.
 * - staleOlderThanMinutes (opcional): idade mínima, default 60.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('reconcile-stale-invoices', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('reconcile-stale-invoices');

    const result = await reconcileStaleInvoices({
      contaId: tenantScope.contaId,
      limit: clampPositiveInt(url.searchParams.get('limit'), 50, 200),
      staleOlderThanMinutes: clampPositiveInt(
        url.searchParams.get('staleOlderThanMinutes'),
        60,
        24 * 60,
      ),
    });
    logJobResult('reconcile-stale-invoices', startedAt, {
      scanned: result.scanned,
      synced: result.synced,
      failed: result.failed,
      recovered: result.recovered,
      paidChargesScanned: result.paidChargesScanned,
      paidChargesRecovered: result.paidChargesRecovered,
      paidChargesFailed: result.paidChargesFailed,
      subscriptionSettingsScanned: result.subscriptionSettingsScanned,
      subscriptionSettingsSynced: result.subscriptionSettingsSynced,
      subscriptionSettingsFailed: result.subscriptionSettingsFailed,
    }, {
      partialFailure: result.failed > 0,
      workStatus: result.synced + result.paidChargesRecovered + result.subscriptionSettingsSynced > 0
        ? 'worked'
        : result.scanned + result.paidChargesScanned + result.subscriptionSettingsScanned === 0 && result.failed === 0 && result.paidChargesFailed === 0 && result.subscriptionSettingsFailed === 0
          ? 'empty'
          : 'unknown',
    });

    return NextResponse.json({ success: result.failed === 0, result });
  } catch (error) {
    if (startedAt) logJobFailure('reconcile-stale-invoices', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar as notas fiscais pendentes.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
