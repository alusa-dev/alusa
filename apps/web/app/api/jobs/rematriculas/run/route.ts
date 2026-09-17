import { NextResponse } from 'next/server';

import { renewalJobsQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  activateRenewalProcessesFromJob,
  listRenewalJobContaIds,
  materializeRenewalContractsFromJob,
  processRenewalOutboxFromJob,
  provisionFutureFinancialAgreementsFromJob,
} from '@/src/server/matriculas/renewal-job-commands.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(req: Request) {
  const url = new URL(req.url);
  const query = renewalJobsQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    maxAccounts: url.searchParams.get('maxAccounts'),
    limit: url.searchParams.get('limit'),
  });
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: query.contaId,
    requireContaIdForCron: false,
  });
  if (!scope.ok) return scope.response;

  const now = new Date();
  const maxAccounts = query.maxAccounts;
  const perAccountLimit = query.limit;

  const accountRows = scope.contaId
    ? [{ contaId: scope.contaId }]
    : await listRenewalJobContaIds({ maxAccounts });

  const results = [];
  for (const { contaId } of accountRows) {
    try {
      const contracts = await materializeRenewalContractsFromJob({ contaId, limit: perAccountLimit });
      const queued = await provisionFutureFinancialAgreementsFromJob({ contaId, now, limit: perAccountLimit });
      const outbox = await processRenewalOutboxFromJob({ contaId, now, limit: perAccountLimit });
      const activated = await activateRenewalProcessesFromJob({ contaId, now, limit: perAccountLimit });
      results.push({ contaId, success: true, contracts, queued, outbox, activated });
    } catch (error) {
      results.push({
        contaId,
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  return NextResponse.json({
    success: results.every((result) => result.success),
    processedAccounts: results.length,
    results,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
