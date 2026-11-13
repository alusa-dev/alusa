import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { cookieConsentInputDTOSchema } from '@/lib/privacy/cookie-consent';
import { requestEvidence } from '@/lib/privacy/evidence';
import { recordCookieConsent } from '@/src/server/privacy/privacy-request.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const parsed = cookieConsentInputDTOSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id ?? null;
  const evidence = requestEvidence(req);
  try {
    await recordCookieConsent({
      anonymousId: parsed.data.anonymousId ?? null,
      userId,
      categories: parsed.data.categories,
      policyVersion: parsed.data.policyVersion,
      ipHash: evidence.ipHash,
      userAgentHash: evidence.userAgentHash,
    });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.privacy.cookie_consent.persist.failed',
      route: '/api/privacy/cookie-consent',
      method: 'POST',
      requestId: getRequestId(req),
      error,
      result: 'persistence_failed',
    });
    return NextResponse.json(
      { error: 'Não foi possível salvar as preferências.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
