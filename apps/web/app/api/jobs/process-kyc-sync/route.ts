import { NextResponse } from 'next/server';
import { processKycReadModelSyncJobs } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(req: Request) {
  const startedAt = startJobRun('process-kyc-sync');
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await processKycReadModelSyncJobs({ contaId: tenantScope.contaId, limit: 10 });
    logJobResult('process-kyc-sync', startedAt, result, {
      partialFailure: result.failed > 0,
      workStatus: result.processed + result.failed > 0 ? 'worked' : 'empty',
    });
    return NextResponse.json({ success: result.failed === 0, result });
  } catch (error) {
    logJobFailure('process-kyc-sync', startedAt, error);
    return NextResponse.json(
      { error: { code: 'ERRO_JOB', message: 'Não foi possível sincronizar os read models de KYC.' } },
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
