import { prisma } from '@alusa/database';

type OperationalMetricsAccessInput = {
  actorId: string;
  actorUsername?: string | null;
  correlationId?: string | null;
  userAgent?: string | null;
  windowMinutes: number;
};

/** Durably records access to the privileged, instance-local metrics snapshot. */
export function recordOperationalMetricsAccess(input: OperationalMetricsAccessInput) {
  return prisma.supportAuditLog.create({
    data: {
      actorId: input.actorId,
      actorUsername: input.actorUsername ?? null,
      action: 'admin.observability.operational_metrics.viewed',
      entityType: 'GLOBAL_OPERATIONAL_METRICS',
      correlationId: input.correlationId ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        actorRole: 'SUPER_ADMIN',
        scope: 'instance-local',
        windowMinutes: input.windowMinutes,
      },
    },
  });
}
