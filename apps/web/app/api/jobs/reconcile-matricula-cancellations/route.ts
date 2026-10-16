import { NextResponse } from 'next/server';
import { resolveTenantScopeForJob, startJobRun, logJobResult } from '@/src/server/jobs/job-observability';

import { reconcileMatriculaCancellationsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  listContasWithPendingMatriculaCancellations,
  reconcilePendingMatriculaCancellations,
} from '@/src/server/enrollments/enrollment-sync.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScopeForJob('reconcile-matricula-cancellations', () => resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
  }));
  if (!scope.ok) return scope.response;
  const startedAt = startJobRun('reconcile-matricula-cancellations');
  const query = reconcileMatriculaCancellationsJobQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    maxAccounts: url.searchParams.get('maxAccounts'),
    limit: url.searchParams.get('limit'),
  });

  const maxAccounts = query.maxAccounts;
  const limit = query.limit;
  const contaIds = scope.contaId
    ? [scope.contaId]
    : await listContasWithPendingMatriculaCancellations({ maxAccounts });

  const results = [];
  const errors: Array<{ contaId: string; error: string }> = [];

  for (const contaId of contaIds) {
    try {
      results.push({
        contaId,
        ...(await reconcilePendingMatriculaCancellations({ contaId, limit })),
      });
    } catch {
      errors.push({
        contaId,
        error: 'Não foi possível reconciliar os cancelamentos desta conta.',
      });
    }
  }

  const processed = results.reduce((total, result) => total + result.processed, 0);
  const reconciled = results.reduce((total, result) => total + result.reconciled.length, 0);
  const failed = errors.length + results.reduce((total, result) => total + result.errors.length, 0);
  logJobResult('reconcile-matricula-cancellations', startedAt, {
    processedAccounts: contaIds.length,
    processed,
    reconciled,
    failed,
  }, {
    partialFailure: failed > 0,
    workStatus: processed > 0 ? 'worked' : failed > 0 ? 'unknown' : 'empty',
  });

  return NextResponse.json({
    success: true,
    processedAccounts: contaIds.length,
    results,
    errors,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
