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
  try {
    const url = new URL(req.url);
    const query = reconcileOpenTransfersJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      limit: url.searchParams.get('limit'),
      maxAccounts: url.searchParams.get('maxAccounts'),
      minAgeSeconds: url.searchParams.get('minAgeSeconds'),
    });
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: query.contaId,
    });
    if (!tenantScope.ok) return tenantScope.response;

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

    return NextResponse.json({
      success: true,
      accountsProcessed: results.length,
      reconciled,
      fetched,
      results,
    });
  } catch (error) {
    console.error('[Job Reconcile Open Transfers] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar as transferências abertas.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
