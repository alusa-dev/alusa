import { NextResponse } from 'next/server';
import { hasCronSecret } from '@/lib/security/route-protection-registry';
import { recordJobRequestRejected, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { drainHubSpotAccountCreatedOutbox } from '@/src/server/public/hubspot-account-created';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!hasCronSecret(req)) {
    recordJobRequestRejected('process-hubspot-account-created-outbox', 401);
    return NextResponse.json({ error: { code: 'NAO_AUTORIZADO', message: 'Credencial de cron inválida.' } }, { status: 401 });
  }

  const startedAt = startJobRun('process-hubspot-account-created-outbox');
  try {
    const result = await drainHubSpotAccountCreatedOutbox({ limit: 1 });
    logJobResult('process-hubspot-account-created-outbox', startedAt, result, {
      partialFailure: result.failed > 0,
      workStatus: result.skipped ? 'empty' : result.claimed > 0 ? 'worked' : 'empty',
    });
    return NextResponse.json({ success: result.failed === 0, ...result }, { status: result.failed > 0 ? 503 : 200 });
  } catch (error) {
    logJobFailure('process-hubspot-account-created-outbox', startedAt, error);
    return NextResponse.json({ error: { code: 'JOB_FAILED', message: 'Não foi possível processar a fila do HubSpot.' } }, { status: 500 });
  }
}
