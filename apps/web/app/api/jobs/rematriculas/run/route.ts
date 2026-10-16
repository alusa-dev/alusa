import { NextResponse } from 'next/server';
import { resolveTenantScopeForJob, startJobRun, logJobResult } from '@/src/server/jobs/job-observability';

import { renewalJobsQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  activateRenewalProcessesFromJob,
  listRenewalJobContaIds,
  materializeRenewalContractsFromJob,
  processRenewalOutboxFromJob,
  provisionFutureFinancialAgreementsFromJob,
} from '@/src/server/enrollments/renewal-job-commands.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScopeForJob('rematriculas-run', () => resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
    requireContaIdForCron: false,
  }));
  if (!scope.ok) return scope.response;
  const startedAt = startJobRun('rematriculas-run');
  const query = renewalJobsQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    maxAccounts: url.searchParams.get('maxAccounts'),
    limit: url.searchParams.get('limit'),
  });

  const now = new Date();
  const maxAccounts = query.maxAccounts;
  const perAccountLimit = query.limit;

  const accountRows = scope.contaId
    ? [{ contaId: scope.contaId }]
    : await listRenewalJobContaIds({ maxAccounts });

  const results = [];
  const counts = {
    failedAccounts: 0,
    contractsMaterialized: 0,
    contractsFailed: 0,
    agreementsQueued: 0,
    agreementsSkipped: 0,
    outboxProcessed: 0,
    outboxFailed: 0,
    outboxSkipped: 0,
    activationsCompleted: 0,
    activationsNeedingAttention: 0,
  };
  for (const { contaId } of accountRows) {
    try {
      const contracts = await materializeRenewalContractsFromJob({ contaId, limit: perAccountLimit });
      counts.contractsMaterialized += contracts.filter((item) => item.success).length;
      counts.contractsFailed += contracts.filter((item) => !item.success).length;

      const queued = await provisionFutureFinancialAgreementsFromJob({ contaId, now, limit: perAccountLimit });
      counts.agreementsQueued += queued.filter((item) => item.status === 'QUEUED').length;
      counts.agreementsSkipped += queued.filter((item) => item.status === 'SKIPPED').length;

      const outbox = await processRenewalOutboxFromJob({ contaId, now, limit: perAccountLimit });
      counts.outboxProcessed += outbox.filter((item) => item.status === 'PROCESSED').length;
      counts.outboxFailed += outbox.filter((item) => item.status === 'FAILED').length;
      counts.outboxSkipped += outbox.filter((item) => item.status === 'SKIPPED').length;

      const activated = await activateRenewalProcessesFromJob({ contaId, now, limit: perAccountLimit });
      counts.activationsCompleted += activated.filter((item) => item.status === 'EFFECTIVE').length;
      counts.activationsNeedingAttention += activated.filter(
        (item) => item.status === 'REQUIRES_ATTENTION',
      ).length;
      results.push({ contaId, success: true, contracts, queued, outbox, activated });
    } catch (error) {
      counts.failedAccounts += 1;
      results.push({
        contaId,
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  const partialFailure = counts.failedAccounts + counts.contractsFailed + counts.outboxFailed > 0;
  const attentionRequired = counts.activationsNeedingAttention > 0;
  logJobResult('rematriculas-run', startedAt, {
    processedAccounts: results.length,
    ...counts,
  }, {
    partialFailure,
    attentionRequired,
    workStatus: counts.contractsMaterialized + counts.contractsFailed + counts.agreementsQueued +
      counts.outboxProcessed + counts.outboxFailed + counts.activationsCompleted +
      counts.activationsNeedingAttention > 0
      ? 'worked'
      : partialFailure ? 'unknown' : 'empty',
  });
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
