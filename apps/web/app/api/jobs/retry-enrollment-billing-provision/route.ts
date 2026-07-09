import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processFamilyBillingOutboxBatch } from '@/src/server/family-billing/processor';
import { processEnrollmentBillingOutboxBatch } from '@/src/server/matriculas/enrollment-billing-outbox.service';
import { retryEnrollmentBillingProvisionJob } from '@/src/server/matriculas/retry-enrollment-billing-provision';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/retry-enrollment-billing-provision
 *
 * Retenta provisionamento financeiro de matrículas individuais incompletas
 * e drena outbox familiar pendente na mesma execução.
 */
async function run(req: Request) {
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

    const [enrollmentOutbox, individualRetry, familyOutbox] = await Promise.all([
      dryRun
        ? Promise.resolve({
            attempted: 0,
            processed: 0,
            failed: 0,
            requiresReconciliation: 0,
            skipped: 0,
            results: [],
          })
        : processEnrollmentBillingOutboxBatch({
            contaId: tenantScope.contaId ?? undefined,
            limit,
          }),
      retryEnrollmentBillingProvisionJob({
        contaId: tenantScope.contaId ?? undefined,
        minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 5,
        limit: Number.isFinite(limit) ? limit : 25,
        dryRun,
      }),
      dryRun
        ? Promise.resolve({ attempted: 0, processed: 0, failed: 0 })
        : processFamilyBillingOutboxBatch({
            contaId: tenantScope.contaId ?? undefined,
            limit: Math.min(limit, 20),
          }),
    ]);

    return NextResponse.json({
      success: true,
      enrollmentOutbox,
      individualRetry,
      familyOutbox,
      dryRun,
    });
  } catch (error) {
    console.error('[jobs/retry-enrollment-billing-provision]', error);
    return jsonError(500, 'JOB_FAILED', (error as Error).message);
  }
}

export const GET = run;
export const POST = run;
