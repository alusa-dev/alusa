import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import { getLowValueNotificationTypes } from './notification-policy';

export async function archiveLowValueNotifications(params: {
  contaId?: string;
  olderThanDays?: number;
  limit?: number;
}): Promise<{ archived: number; cutoff: Date }> {
  const olderThanDays = Math.min(Math.max(params.olderThanDays ?? 30, 1), 3650);
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 5000);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const where: Prisma.NotificationRecipientWhereInput = {
    ...(params.contaId ? { contaId: params.contaId } : {}),
    archivedAt: null,
    notification: {
      createdAt: { lt: cutoff },
      type: { in: getLowValueNotificationTypes() },
    },
  };

  const recipients = await prisma.notificationRecipient.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  if (recipients.length === 0) {
    return { archived: 0, cutoff };
  }

  const result = await prisma.notificationRecipient.updateMany({
    where: {
      id: { in: recipients.map((recipient) => recipient.id) },
      ...(params.contaId ? { contaId: params.contaId } : {}),
    },
    data: {
      archivedAt: new Date(),
      readAt: new Date(),
    },
  });

  logInboxMetric('inbox.retention.archived', {
    contaId: params.contaId ?? 'all',
    archived: result.count,
    olderThanDays,
  });

  return { archived: result.count, cutoff };
}
