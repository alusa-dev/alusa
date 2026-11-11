import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import { NotificationSeverity, NotificationType, Role, Status, type Prisma } from '@prisma/client';
import { isInternalNotificationTypeAllowed } from './notification-policy';
import type { CreateNotificationInput, CreateNotificationResult, NotificationActor } from './notification-types';

const DEFAULT_RECIPIENT_ROLES: Role[] = ['ADMIN', 'FINANCEIRO', 'RECEPCAO'];
function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
export async function resolveRecipientUserIds(
  tx: Prisma.TransactionClient,
  input: Pick<CreateNotificationInput, 'contaId' | 'recipientUserIds' | 'recipientRoles'>,
  actor?: NotificationActor,
): Promise<string[]> {
  const requestedUserIds = uniq(input.recipientUserIds ?? []);

  const users = await tx.usuario.findMany({
    where: {
      contaId: input.contaId,
      status: Status.ATIVO,
      ...(requestedUserIds.length > 0
        ? { id: { in: requestedUserIds } }
        : {
            role: {
              in:
                input.recipientRoles && input.recipientRoles.length > 0
                  ? input.recipientRoles
                  : DEFAULT_RECIPIENT_ROLES,
            },
          }),
    },
    select: { id: true },
  });

  const actorUserId = actor?.type === 'USER' ? actor.id?.trim() : null;
  return users.map((user) => user.id).filter((userId) => userId !== actorUserId);
}
export async function createNotification(input: CreateNotificationInput): Promise<CreateNotificationResult> {
  if (!isInternalNotificationTypeAllowed(input.type)) {
    logInboxMetric('inbox.skipped.policy', {
      contaId: input.contaId,
      type: input.type,
      dedupeKey: input.dedupeKey,
    });
    return {
      notificationId: null,
      created: false,
      recipientCount: 0,
      reason: 'policy_excluded',
    };
  }

  return prisma.$transaction(async (tx) => {
    const recipientUserIds = await resolveRecipientUserIds(tx, input, input.actor);
    if (recipientUserIds.length === 0) {
      logInboxMetric('inbox.skipped.no_recipients', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
      });
      return {
        notificationId: null,
        created: false,
        recipientCount: 0,
        reason: 'no_recipients',
      };
    }

    let notification: { id: string } | null = null;
    let created = false;

    notification = await tx.notification.findUnique({
      where: {
        contaId_dedupeKey: {
          contaId: input.contaId,
          dedupeKey: input.dedupeKey,
        },
      },
      select: { id: true },
    });

    if (notification) {
      logInboxMetric('inbox.deduped', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
      });

    } else {
      const createResult = await tx.notification.createMany({
        data: {
          contaId: input.contaId,
          type: input.type,
          category: input.category,
          severity: input.severity ?? NotificationSeverity.INFO,
          title: input.title,
          message: input.message,
          dedupeKey: input.dedupeKey,
          relatedPath: input.relatedPath ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          actorType: input.actor?.type,
          actorId: input.actor?.id ?? null,
          metadata: input.metadata,
          triggeredAt: input.triggeredAt ?? new Date(),
        },
        skipDuplicates: true,
      });

      created = createResult.count > 0;
      notification = await tx.notification.findUnique({
        where: {
          contaId_dedupeKey: {
            contaId: input.contaId,
            dedupeKey: input.dedupeKey,
          },
        },
        select: { id: true },
      });

      if (!created) {
        logInboxMetric('inbox.deduped', {
          contaId: input.contaId,
          dedupeKey: input.dedupeKey,
          type: input.type,
        });
      }
    }

    if (!notification) {
      throw new Error(`Falha ao resolver notificação para dedupeKey ${input.dedupeKey}`);
    }

    await tx.notificationRecipient.createMany({
      data: recipientUserIds.map((userId) => ({
        notificationId: notification.id,
        contaId: input.contaId,
        userId,
      })),
      skipDuplicates: true,
    });

    if (created) {
      logInboxMetric('inbox.created', {
        contaId: input.contaId,
        type: input.type,
        dedupeKey: input.dedupeKey,
        recipientCount: recipientUserIds.length,
      });
      await tx.auditLog.create({
        data: {
          contaId: input.contaId,
          actorType: input.actor?.type ?? 'SYSTEM',
          actorId: input.actor?.id ?? null,
          action: 'notification.created',
          entityType: 'Notification',
          entityId: notification.id,
          metadata: {
            type: input.type,
            category: input.category,
            severity: input.severity ?? NotificationSeverity.INFO,
            dedupeKey: input.dedupeKey,
            recipientCount: recipientUserIds.length,
            sourceType: input.sourceType ?? null,
            sourceId: input.sourceId ?? null,
          },
        },
      });
    }

    return {
      notificationId: notification.id,
      created,
      recipientCount: recipientUserIds.length,
    };
  });
}

export async function createEnrollmentCreatedNotification(params: {
  contaId: string;
  matriculaId: string;
  actorUserId?: string | null;
}): Promise<CreateNotificationResult> {
  // Criação de matrícula é feedback síncrono da própria tela (toast), não
  // uma mudança assíncrona que deva entrar na inbox operacional.
  logInboxMetric('inbox.skipped.policy', {
    contaId: params.contaId,
    type: NotificationType.ENROLLMENT_CREATED,
    dedupeKey: `enrollment:created:${params.matriculaId}`,
  });
  return { notificationId: null, created: false, recipientCount: 0 };
}
