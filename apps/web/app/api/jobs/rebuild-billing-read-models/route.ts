import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import {
  rebuildFinanceBillingReadModels,
  refreshFinanceBillingRemoteSnapshots,
} from '@alusa/finance';

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

async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('rebuild-billing-read-models', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('rebuild-billing-read-models');

    const limit = clampPositiveInt(url.searchParams.get('limit'), 100, 500);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 100);
    const projection = await rebuildFinanceBillingReadModels({
      contaId: tenantScope.contaId,
      limit,
      maxAccounts,
    });

    const refreshRemote = url.searchParams.get('refreshRemote') === 'true';
    const remote = refreshRemote
      ? await refreshFinanceBillingRemoteSnapshots({
          contaId: tenantScope.contaId,
          limit: clampPositiveInt(url.searchParams.get('remoteLimit'), 25, 100),
          maxAccounts,
          staleOlderThanMinutes: clampPositiveInt(
            url.searchParams.get('staleOlderThanMinutes'),
            360,
            24 * 60,
          ),
        })
      : null;

    const failed = projection.failed + (remote?.failed ?? 0);
    logJobResult('rebuild-billing-read-models', startedAt, {
      accounts: projection.accounts + (remote?.accounts ?? 0),
      subscriptionsProjected: projection.subscriptionsProjected,
      installmentsProjected: projection.installmentsProjected,
      remoteSubscriptionsRefreshed: remote?.remoteSubscriptionsRefreshed ?? 0,
      remoteInstallmentsRefreshed: remote?.remoteInstallmentsRefreshed ?? 0,
      missingCredentials: projection.missingCredentials + (remote?.missingCredentials ?? 0),
      failed,
    }, {
      partialFailure: failed > 0,
      workStatus: projection.subscriptionsProjected + projection.installmentsProjected +
        (remote?.remoteSubscriptionsRefreshed ?? 0) + (remote?.remoteInstallmentsRefreshed ?? 0) > 0
        ? 'worked'
        : failed > 0 || projection.missingCredentials + (remote?.missingCredentials ?? 0) > 0
          ? 'unknown'
          : 'empty',
    });

    return NextResponse.json({
      success: projection.failed === 0 && (!remote || remote.failed === 0),
      projection,
      remote,
    });
  } catch (error) {
    if (startedAt) logJobFailure('rebuild-billing-read-models', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconstruir os read models financeiros.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
