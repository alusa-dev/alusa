import { Prisma } from '@prisma/client';

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function recordEventAudit(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    eventId?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
) {
  await tx.eventAudit.create({
    data: {
      contaId: params.contaId,
      eventId: params.eventId ?? null,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before === undefined ? undefined : toAuditJson(params.before),
      after: params.after === undefined ? undefined : toAuditJson(params.after),
      metadata: params.metadata === undefined ? undefined : toAuditJson(params.metadata),
    },
  });

  await tx.auditLog.create({
    data: {
      contaId: params.contaId,
      actorType: 'USER',
      actorId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata === undefined ? undefined : toAuditJson(params.metadata),
    },
  });
}
