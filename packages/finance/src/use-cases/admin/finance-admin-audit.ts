import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';

export async function recordFinanceAdminAction(input: {
  contaId: string;
  action: string;
  entity?: { type: string; id?: string };
  reason: string;
  actor: { type: AuditActorType; id?: string | null };
  metadata?: Record<string, unknown>;
}) {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    throw new Error('Informe uma justificativa com pelo menos 8 caracteres.');
  }

  await auditLogService.record({
    contaId: input.contaId,
    action: input.action,
    entity: input.entity,
    metadata: {
      ...input.metadata,
      reason,
    },
    actor: input.actor.id ? { type: input.actor.type, id: input.actor.id } : { type: input.actor.type },
  });
}
