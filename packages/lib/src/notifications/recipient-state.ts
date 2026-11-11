import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export async function updateNotificationRecipientState(params: {
  contaId: string;
  userId: string;
  notificationId: string;
  action: 'read' | 'unread' | 'archive' | 'unarchive';
}): Promise<boolean> {
  const updatedAt = new Date();
  const data: Prisma.NotificationRecipientUpdateManyMutationInput = {};

  if (params.action === 'read') data.readAt = updatedAt;
  if (params.action === 'unread') data.readAt = null;
  if (params.action === 'archive') {
    data.archivedAt = updatedAt;
    data.readAt = updatedAt;
  }
  if (params.action === 'unarchive') data.archivedAt = null;

  return prisma.$transaction(async (tx) => {
    const result = await tx.notificationRecipient.updateMany({
      where: {
        contaId: params.contaId,
        userId: params.userId,
        notificationId: params.notificationId,
        deletedAt: null,
      },
      data,
    });

    if (result.count > 0) {
      await tx.auditLog.create({
        data: {
          contaId: params.contaId,
          actorType: 'USER',
          actorId: params.userId,
          action: `notification.${params.action}`,
          entityType: 'Notification',
          entityId: params.notificationId,
        },
      });
    }

    return result.count > 0;
  });
}

export async function deleteNotificationRecipient(params: {
  contaId: string;
  userId: string;
  notificationId: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const deletedAt = new Date();
    const deleted = await tx.notificationRecipient.updateMany({
      where: {
        contaId: params.contaId,
        userId: params.userId,
        notificationId: params.notificationId,
        deletedAt: null,
      },
      data: {
        deletedAt,
        readAt: deletedAt,
        archivedAt: deletedAt,
      },
    });

    if (deleted.count === 0) {
      return false;
    }

    await tx.auditLog.create({
      data: {
        contaId: params.contaId,
        actorType: 'USER',
        actorId: params.userId,
        action: 'notification.deleted',
        entityType: 'Notification',
        entityId: params.notificationId,
      },
    });

    return true;
  });
}

export async function markAllNotificationsAsRead(params: {
  contaId: string;
  userId: string;
}): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.notificationRecipient.updateMany({
      where: {
        contaId: params.contaId,
        userId: params.userId,
        archivedAt: null,
        readAt: null,
        deletedAt: null,
      },
      data: { readAt: new Date() },
    });

    if (result.count > 0) {
      await tx.auditLog.create({
        data: {
          contaId: params.contaId,
          actorType: 'USER',
          actorId: params.userId,
          action: 'notification.read_all',
          entityType: 'Notification',
          metadata: { updatedCount: result.count },
        },
      });
    }

    return result.count;
  });
}
