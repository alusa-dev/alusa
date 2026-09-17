import { NextResponse } from 'next/server';

import { publicPrivacyRequestDTOSchema } from '@/features/privacy/dtos';
import { requestEvidence } from '@/lib/privacy/evidence';
import { checkSecurityRateLimit } from '@/lib/security/rate-limit';
import { createPublicPrivacyRequest } from '@/src/server/privacy/privacy-request.service';

export async function POST(req: Request) {
  const limiter = checkSecurityRateLimit(req, 'PRIVACY_REQUEST');
  if (!limiter.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  const parsed = publicPrivacyRequestDTOSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const evidence = requestEvidence(req);
  const request = await createPublicPrivacyRequest({
    requestType: parsed.data.requestType,
    requesterEmail: parsed.data.requesterEmail,
    requesterName: parsed.data.requesterName,
    details: parsed.data.details,
    ipHash: evidence.ipHash,
    userAgentHash: evidence.userAgentHash,
  });

  return NextResponse.json(
    { ok: true, requestId: request.id },
    { status: 202, headers: { 'cache-control': 'no-store' } },
  );
}
