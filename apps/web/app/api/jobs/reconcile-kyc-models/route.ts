import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { reconcileKycModels } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/reconcile-kyc-models
 *
 * Reconcilia snapshots/modelos KYC locais com o estado oficial Asaas.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('reconcile-kyc-models', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('reconcile-kyc-models');

    const dryRun = url.searchParams.get('dryRun') === 'true';
    const result = await reconcileKycModels({
      contaId: tenantScope.contaId,
      dryRun,
    });
    logJobResult('reconcile-kyc-models', startedAt, {
      checkedAccounts: result.checkedAccounts,
      inconsistenciesFound: result.inconsistenciesFound,
      reconciled: result.reconciled,
      errors: result.errors.length,
    }, {
      dryRun,
      partialFailure: result.errors.length > 0,
      workStatus: result.inconsistenciesFound + result.reconciled > 0
        ? 'worked'
        : result.errors.length > 0 || result.checkedAccounts >= 100 ? 'unknown' : 'empty',
    });

    return NextResponse.json({
      success: result.errors.length === 0,
      result,
    });
  } catch (error) {
    if (startedAt) logJobFailure('reconcile-kyc-models', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar os dados de KYC.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
