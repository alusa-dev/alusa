import { prisma } from '@/lib/prisma';

export async function recordCookieConsent(input: {
  anonymousId: string | null;
  userId: string | null;
  categories: Record<string, boolean>;
  policyVersion: string;
  ipHash: string | null;
  userAgentHash: string | null;
}) {
  const now = new Date();
  const hasOnlyEssential = Object.entries(input.categories)
    .filter(([category]) => category !== 'essential')
    .every(([, enabled]) => enabled !== true);
  await prisma.cookieConsent.create({
    data: {
      anonymousId: input.anonymousId,
      userId: input.userId,
      categories: input.categories,
      acceptedAt: hasOnlyEssential ? null : now,
      rejectedAt: hasOnlyEssential ? now : null,
      policyVersion: input.policyVersion,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
    },
  });
}

export async function createPrivacyExportRequest(input: {
  contaId: string;
  userId: string;
  subjectType: string;
  subjectId: string;
  requesterEmail: string | null;
  requesterName: string | null;
  details: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
}) {
  const request = await prisma.privacyRequest.create({
    data: {
      contaId: input.contaId,
      userId: input.userId,
      requestType: 'EXPORT',
      status: 'PENDING_REVIEW',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requesterEmail: input.requesterEmail,
      requesterName: input.requesterName,
      details: input.details,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      metadata: {
        source: 'api/privacy/export',
        excludes: ['passwords', 'tokens', 'secrets', 'webhookRawPayloads', 'securityInternalLogs'],
      },
    },
  });
  await prisma.sensitiveAccessLog.create({
    data: {
      contaId: input.contaId,
      actorUserId: input.userId,
      action: 'privacy.export.requested',
      entityType: 'PrivacyRequest',
      entityId: request.id,
      requestId: request.id,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      metadata: { status: request.status },
    },
  });
  return request;
}

export async function getPrivacyRequest(input: { contaId: string; userId: string; requestId: string }) {
  return prisma.privacyRequest.findFirst({
    where: {
      id: input.requestId,
      contaId: input.contaId,
      OR: [{ userId: input.userId }, { userId: null }],
    },
    select: {
      id: true,
      requestType: true,
      status: true,
      action: true,
      resultUrl: true,
      rejectedReason: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });
}

export async function createPublicPrivacyRequest(input: {
  requestType: string;
  requesterEmail: string;
  requesterName: string;
  details: string;
  ipHash: string | null;
  userAgentHash: string | null;
}) {
  return prisma.privacyRequest.create({
    data: {
      requestType: input.requestType,
      status: 'PENDING_REVIEW',
      requesterEmail: input.requesterEmail,
      requesterName: input.requesterName,
      details: input.details,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      metadata: { source: 'public-lgpd-form' },
    },
  });
}
