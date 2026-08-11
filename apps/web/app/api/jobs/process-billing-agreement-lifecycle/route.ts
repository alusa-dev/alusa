import { NextResponse } from 'next/server';
import {
  processDueBillingAgreementChanges,
  processExpiredBillingAllocations,
  processPendingBillingAdjustments,
} from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const scope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!scope.ok) return scope.response;
    const parsedLimit = Number(url.searchParams.get('limit') ?? '25');
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 25;
    // A alteração do acordo precisa existir antes de seus créditos/complementos.
    const scheduled = await processDueBillingAgreementChanges({
      contaId: scope.contaId ?? undefined,
      limit,
    });
    const expiredAllocations = await processExpiredBillingAllocations({
      contaId: scope.contaId ?? undefined,
      limit,
    });
    const adjustments = await processPendingBillingAdjustments({
      contaId: scope.contaId ?? undefined,
      limit,
    });
    return NextResponse.json({ success: true, scheduled, expiredAllocations, adjustments });
  } catch (error) {
    console.error('[jobs/process-billing-agreement-lifecycle]', error);
    return NextResponse.json(
      { error: { code: 'BILLING_LIFECYCLE_JOB_FAILED', message: error instanceof Error ? error.message : String(error) } },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
