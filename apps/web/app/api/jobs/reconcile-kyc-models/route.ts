import { NextResponse } from 'next/server';
import { reconcileKycModels } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET/POST /api/jobs/reconcile-kyc-models
 *
 * Reconcilia snapshots/modelos KYC locais com o estado oficial Asaas.
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const dryRun = url.searchParams.get('dryRun') === 'true';
    const result = await reconcileKycModels({
      contaId: tenantScope.contaId,
      dryRun,
    });

    return NextResponse.json({
      success: result.errors.length === 0,
      result,
    });
  } catch (error) {
    console.error('[Job Reconcile KYC Models] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
