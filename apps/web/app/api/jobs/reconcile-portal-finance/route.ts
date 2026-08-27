import { NextResponse } from 'next/server';
import { reconcileFinanceWebhooksJob } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limit = clampPositiveInt(url.searchParams.get('limit'), 50, 200);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 100);
    const staleOlderThanMinutes = clampPositiveInt(
      url.searchParams.get('staleOlderThanMinutes'),
      360,
      24 * 60,
    );
    const job = await reconcileFinanceWebhooksJob({
      contaId: tenantScope.contaId,
      limit,
      maxAccounts,
      includeGaps: false,
      mode: 'targeted',
      providerCheckIntervalMinutes: staleOlderThanMinutes,
      maxAsaasCalls: limit,
      accountConcurrency: 2,
    });

    return NextResponse.json({
      success: job.outcome === 'completed',
      processedAccounts: job.accountsProcessed,
      attempted: job.results.reduce((sum, item) => sum + item.reconcile.checkedPayments, 0),
      successCount: job.results.reduce((sum, item) => sum + item.reconcile.reconciledPayments, 0),
      failedCount: job.errors.length,
      results: job.results,
      job,
    }, { status: job.outcome === 'failed' ? 502 : job.outcome === 'partial' ? 207 : 200 });
  } catch (error) {
    console.error('[Job Reconcile Portal Finance] Erro não classificado:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
    return jsonError(500, 'ERRO_JOB', 'Não foi possível concluir a reconciliação financeira.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
