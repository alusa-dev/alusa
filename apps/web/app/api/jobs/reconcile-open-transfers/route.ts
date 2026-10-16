import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { listAccountsWithOpenTransfers, reconcileOpenTransfers } from '@alusa/finance';

import { reconcileOpenTransfersJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/reconcile-open-transfers
 *
 * Reconsulta transferências abertas no Asaas fora do caminho de leitura da UI.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
        const tenantScope = await resolveTenantScopeForJob('reconcile-open-transfers', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) return tenantScope.response;
    startedAt = startJobRun('reconcile-open-transfers');
const query = reconcileOpenTransfersJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      limit: url.searchParams.get('limit'),
      maxAccounts: url.searchParams.get('maxAccounts'),
      minAgeSeconds: url.searchParams.get('minAgeSeconds'),
    });

    const limit = query.limit;
    const maxAccounts = query.maxAccounts;
    const minAgeMs = query.minAgeSeconds * 1000;
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listAccountsWithOpenTransfers(maxAccounts);

    const results = [];
    for (const contaId of contaIds) {
      const result = await reconcileOpenTransfers({ contaId, limit, minAgeMs });
      results.push({
        contaId,
        reconciled: result.reconciled,
        fetched: result.officialTransfersById.size,
      });
    }

    const reconciled = results.reduce((sum, item) => sum + item.reconciled, 0);
    const fetched = results.reduce((sum, item) => sum + item.fetched, 0);
    logJobResult('reconcile-open-transfers', startedAt, {
      accountsProcessed: results.length,
      reconciled,
      fetched,
    }, { workStatus: fetched > 0 ? 'worked' : results.length > 0 ? 'unknown' : 'empty' });

    return NextResponse.json({
      success: true,
      accountsProcessed: results.length,
      reconciled,
      fetched,
      results,
    });
  } catch (error) {
    if (startedAt) logJobFailure('reconcile-open-transfers', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar as transferências abertas.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
