import { prisma } from '@alusa/database';
import type { AuditActorType, Prisma } from '@prisma/client';

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
  async record(
    params: {
      contaId: string;
      action: string;
      entity?: AuditEntityRef;
      metadata?: unknown;
      actor?: AuditActorRef;
      correlationId?: string;
    },
    db: Pick<Prisma.TransactionClient, 'auditLog'> = prisma,
  ) {
    const validated = auditLogRecordSchema.parse(params);

    return db.auditLog.create({
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
