import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth-options';
import { requestEvidence } from '@/lib/privacy/evidence';
import { checkSecurityRateLimit } from '@/lib/security/rate-limit';

const exportRequestSchema = z.object({
  subjectType: z.enum(['USER', 'ALUNO', 'RESPONSAVEL', 'CONTA']).default('USER'),
  subjectId: z.string().trim().max(128).optional(),
  details: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.id || !user.contaId) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }

  const limiter = checkSecurityRateLimit(req, 'PRIVACY_EXPORT', user.id);
  if (!limiter.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  const parsed = exportRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const evidence = requestEvidence(req);
  const request = await prisma.privacyRequest.create({
    data: {
      contaId: user.contaId,
      userId: user.id,
      requestType: 'EXPORT',
      status: 'PENDING_REVIEW',
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId ?? user.id,
      requesterEmail: user.email ?? null,
      requesterName: user.name ?? null,
      details: parsed.data.details ?? null,
      ipHash: evidence.ipHash,
      userAgentHash: evidence.userAgentHash,
      metadata: {
        source: 'api/privacy/export',
        excludes: ['passwords', 'tokens', 'secrets', 'webhookRawPayloads', 'securityInternalLogs'],
      },
    },
  });

  await prisma.sensitiveAccessLog.create({
    data: {
      contaId: user.contaId,
      actorUserId: user.id,
      action: 'privacy.export.requested',
      entityType: 'PrivacyRequest',
      entityId: request.id,
      requestId: request.id,
      ipHash: evidence.ipHash,
      userAgentHash: evidence.userAgentHash,
      metadata: { status: request.status },
    },
  });

  return NextResponse.json({ requestId: request.id, status: request.status }, { status: 202 });
}
