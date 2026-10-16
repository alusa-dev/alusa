import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processAsaasProvisioningJobs } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('provision-asaas-subaccounts', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireAdmin: false,
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('provision-asaas-subaccounts');

    const limitRaw = Number(url.searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 10;

    const result = await processAsaasProvisioningJobs({
      contaId: tenantScope.contaId,
      limit,
    });
    logJobResult('provision-asaas-subaccounts', startedAt, {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      recoveryRequired: result.recoveryRequired,
      webhookJobsQueued: result.webhookJobsQueued,
    }, {
      partialFailure: result.failed > 0 || result.recoveryRequired > 0,
      workStatus: result.processed > 0
        ? 'worked'
        : result.failed > 0 || result.recoveryRequired > 0
          ? 'unknown'
          : 'empty',
    });

    return NextResponse.json({ success: true, processed: result });
  } catch (error) {
    if (startedAt) logJobFailure('provision-asaas-subaccounts', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível provisionar as subcontas financeiras.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
