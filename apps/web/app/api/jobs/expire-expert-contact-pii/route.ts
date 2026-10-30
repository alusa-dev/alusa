import { NextResponse } from 'next/server';
import { hasCronSecret } from '@/lib/security/route-protection-registry';
import { recordJobRequestRejected, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { redactExpiredExpertContactLeadPii } from '@/src/server/public/expert-contact-retention';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!hasCronSecret(req)) {
    recordJobRequestRejected('expire-expert-contact-pii', 401);
    return NextResponse.json({ error: { code: 'NAO_AUTORIZADO', message: 'Credencial de cron inválida.' } }, { status: 401 });
  }

  const startedAt = startJobRun('expire-expert-contact-pii');
  try {
    const result = await redactExpiredExpertContactLeadPii();
    logJobResult('expire-expert-contact-pii', startedAt, { redacted: result.redacted }, {
      workStatus: result.redacted > 0 ? 'worked' : 'empty',
    });
    return NextResponse.json({ success: true, ...result, cutoff: result.cutoff.toISOString() });
  } catch (error) {
    logJobFailure('expire-expert-contact-pii', startedAt, error);
    return NextResponse.json({ error: { code: 'EXPERT_CONTACT_RETENTION_FAILED', message: 'Não foi possível aplicar a retenção dos contatos públicos.' } }, { status: 500 });
  }
}
