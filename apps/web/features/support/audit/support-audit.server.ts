import type { Prisma, SupportRole } from '@prisma/client';

import type { GlobalAdminSession } from '@/features/global-admin/auth/session.server';
import prisma from '@/lib/prisma';

export type SupportAuditInput = {
  actorId?: string | null;
  actorUsername?: string | null;
  actorRole?: SupportRole | null;
  contaId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  action: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
};

export async function recordSupportAudit(input: SupportAuditInput) {
  return prisma.supportAuditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername ?? null,
      actorRole: input.actorRole ?? null,
      contaId: input.contaId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      correlationId: input.correlationId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}

export function auditActorFromSession(session: GlobalAdminSession) {
  return {
    actorId: session.supportUserId ?? null,
    actorUsername: session.username,
    actorRole: session.role,
  };
}

export function requestAuditMetadata(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return {
    ip: forwarded?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent') ?? null,
  };
}
