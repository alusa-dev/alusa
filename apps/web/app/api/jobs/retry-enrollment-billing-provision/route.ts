import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processFamilyBillingOutboxBatch } from '@/src/server/family-billing/processor';
import { processEnrollmentBillingOutboxBatch } from '@/src/server/matriculas/enrollment-billing-outbox.service';
import { retryEnrollmentBillingProvisionJob } from '@/src/server/matriculas/retry-enrollment-billing-provision';
import { apiJsonError } from '@/lib/api/standard-response';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * POST /api/jobs/retry-enrollment-billing-provision
 *
 * Retenta provisionamento financeiro de matrículas individuais incompletas
 * e drena outbox familiar pendente na mesma execução.
 */
async function run(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const minAgeMinutes = Number(url.searchParams.get('minAgeMinutes') ?? '5');
    const limit = Number(url.searchParams.get('limit') ?? '25');
    const dryRun = url.searchParams.get('dryRun') === 'true';

    // A ordem determinística evita que o retry concorra com o drain do mesmo
    // outbox e reduza o ganho de idempotência a uma disputa entre workers.
    const enrollmentOutbox = dryRun
      ? {
          attempted: 0,
          processed: 0,
          failed: 0,
          requiresReconciliation: 0,
          skipped: 0,
          results: [],
        }
      : await processEnrollmentBillingOutboxBatch({
          contaId: tenantScope.contaId ?? undefined,
          limit,
        });

    const familyOutbox = dryRun
      ? { attempted: 0, processed: 0, failed: 0 }
      : await processFamilyBillingOutboxBatch({
          contaId: tenantScope.contaId ?? undefined,
          limit: Math.min(limit, 20),
        });

    const individualRetry = await retryEnrollmentBillingProvisionJob({
      contaId: tenantScope.contaId ?? undefined,
      minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 5,
      limit: Number.isFinite(limit) ? limit : 25,
      dryRun,
    });

    const response = {
      success: true,
      enrollmentOutbox,
      individualRetry,
      familyOutbox,
      dryRun,
    };
    logJobResult('retry-enrollment-billing-provision', startedAt, {
      enrollmentAttempted: enrollmentOutbox.attempted,
      enrollmentProcessed: enrollmentOutbox.processed,
      familyAttempted: familyOutbox.attempted,
      familyProcessed: familyOutbox.processed,
      ...individualRetry,
    }, { dryRun });
    return NextResponse.json(response);
  } catch (error) {
    logJobFailure('retry-enrollment-billing-provision', startedAt, error);
    return jsonError(500, 'JOB_FAILED', 'Não foi possível processar o job de provisionamento.');
  }
}

export const GET = run;
export const POST = run;
