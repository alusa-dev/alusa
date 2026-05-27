import { NextResponse } from 'next/server';
import { z } from 'zod';

import prisma from '@/lib/prisma';
import { requestEvidence } from '@/lib/privacy/evidence';
import { checkSecurityRateLimit } from '@/lib/security/rate-limit';

const publicPrivacyRequestSchema = z.object({
  requesterName: z.string().trim().min(2).max(120),
  requesterEmail: z.string().trim().email().max(180),
  requestType: z.enum([
    'CONFIRMATION',
    'ACCESS',
    'CORRECTION',
    'ANONYMIZATION',
    'BLOCKING',
    'DELETION',
    'PORTABILITY',
    'SHARING_INFO',
    'CONSENT_REVOCATION',
    'OPPOSITION',
    'AUTOMATED_DECISION_REVIEW',
  ]),
  details: z.string().trim().min(10).max(3000),
});

export async function POST(req: Request) {
  const limiter = checkSecurityRateLimit(req, 'PRIVACY_REQUEST');
  if (!limiter.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  const parsed = publicPrivacyRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const evidence = requestEvidence(req);
  const request = await prisma.privacyRequest.create({
    data: {
      requestType: parsed.data.requestType,
      status: 'PENDING_REVIEW',
      requesterEmail: parsed.data.requesterEmail,
      requesterName: parsed.data.requesterName,
      details: parsed.data.details,
      ipHash: evidence.ipHash,
      userAgentHash: evidence.userAgentHash,
      metadata: { source: 'public-lgpd-form' },
    },
  });

  return NextResponse.json(
    { ok: true, requestId: request.id },
    { status: 202, headers: { 'cache-control': 'no-store' } },
  );
}
