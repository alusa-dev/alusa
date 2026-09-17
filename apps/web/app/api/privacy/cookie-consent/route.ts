import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { cookieConsentInputDTOSchema } from '@/lib/privacy/cookie-consent';
import { requestEvidence } from '@/lib/privacy/evidence';
import { recordCookieConsent } from '@/src/server/privacy/privacy-request.service';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const parsed = cookieConsentInputDTOSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id ?? null;
  const evidence = requestEvidence(req);
  await recordCookieConsent({
    anonymousId: parsed.data.anonymousId ?? null,
    userId,
    categories: parsed.data.categories,
    policyVersion: parsed.data.policyVersion,
    ipHash: evidence.ipHash,
    userAgentHash: evidence.userAgentHash,
  });

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
