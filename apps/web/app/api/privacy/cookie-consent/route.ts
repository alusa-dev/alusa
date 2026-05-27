import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth-options';
import { cookieConsentInputSchema } from '@/lib/privacy/cookie-consent';
import { requestEvidence } from '@/lib/privacy/evidence';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const parsed = cookieConsentInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = session?.user?.id ?? null;
  const evidence = requestEvidence(req);
  const now = new Date();
  const hasOnlyEssential =
    parsed.data.categories.analytics !== true &&
    parsed.data.categories.marketing !== true &&
    parsed.data.categories.preferences !== true;

  await prisma.cookieConsent.create({
    data: {
      anonymousId: parsed.data.anonymousId ?? null,
      userId,
      categories: parsed.data.categories,
      acceptedAt: hasOnlyEssential ? null : now,
      rejectedAt: hasOnlyEssential ? now : null,
      policyVersion: parsed.data.policyVersion,
      ipHash: evidence.ipHash,
      userAgentHash: evidence.userAgentHash,
    },
  });

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
