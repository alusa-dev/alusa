import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogRecordSchema } from './schemas';

export type AuditEntityRef = {
  type: string;
  id?: string;
};

export type AuditActorRef = {
  type: AuditActorType;
  id?: string;
};

export const auditLogService = {
  async record(params: {
    contaId: string;
    action: string;
    entity?: AuditEntityRef;
    metadata?: unknown;
    actor?: AuditActorRef;
    correlationId?: string;
  }) {
    const validated = auditLogRecordSchema.parse(params);

    return prisma.auditLog.create({
      data: {
        contaId: validated.contaId,
        action: validated.action,
        entityType: validated.entity?.type,
        entityId: validated.entity?.id,
        correlationId: params.correlationId ?? undefined,
        metadata: validated.metadata as never,
        actorType: (validated.actor?.type ?? 'SYSTEM') as AuditActorType,
        actorId: validated.actor?.id,
      },
    });
  },
};
