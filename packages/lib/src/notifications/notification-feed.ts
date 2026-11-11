import { prisma } from '../prisma';
import { withDatabaseRetry } from '../database-retry';
import { NotificationCategory, NotificationSeverity, NotificationType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { NotificationFeedView, NotificationListItem, NotificationListResult } from './notification-types';
import { resolveBillingNotificationContent } from './notification-content';
import { extractWebhookEventName, extractBillingOriginContext } from './billing-notification';

const ACTIVE_VIEW = 'active';
const ARCHIVED_VIEW = 'archived';


function buildRecipientWhere(view: NotificationFeedView): Prisma.NotificationRecipientWhereInput {
  const activeRecipient = { deletedAt: null };
  if (view === ARCHIVED_VIEW) {
    return { ...activeRecipient, archivedAt: { not: null } };
  }
  if (view === ACTIVE_VIEW) {
    return { ...activeRecipient, archivedAt: null };
  }
  return activeRecipient;
}


function serializeNotificationItem(
  recipient: {
    readAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    notification: {
      id: string;
      type: NotificationType;
      category: NotificationCategory;
      severity: NotificationSeverity;
      title: string;
      message: string;
      relatedPath: string | null;
      entityType: string | null;
      entityId: string | null;
      sourceType: string | null;
      sourceId: string | null;
      metadata: Prisma.JsonValue | null;
      triggeredAt: Date;
      createdAt: Date;
    };
  },
): NotificationListItem {
  return {
    id: recipient.notification.id,
    type: recipient.notification.type,
    category: recipient.notification.category,
    severity: recipient.notification.severity,
    title: recipient.notification.title,
    message: recipient.notification.message,
    relatedPath: recipient.notification.relatedPath,
    entityType: recipient.notification.entityType,
    entityId: recipient.notification.entityId,
    sourceType: recipient.notification.sourceType,
    sourceId: recipient.notification.sourceId,
    metadata: recipient.notification.metadata,
    triggeredAt: recipient.notification.triggeredAt,
    createdAt: recipient.notification.createdAt,
    readAt: recipient.readAt,
    archivedAt: recipient.archivedAt,
  };
}




export async function listNotifications(params: {
  contaId: string;
  userId: string;
  limit?: number;
  page?: number;
  view?: NotificationFeedView;
}): Promise<NotificationListResult> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const view = params.view ?? ACTIVE_VIEW;
  const where: Prisma.NotificationRecipientWhereInput = {
    contaId: params.contaId,
    userId: params.userId,
    ...buildRecipientWhere(view),
  };

  const [recipients, unreadCount, totalCount] = await Promise.all([
    prisma.notificationRecipient.findMany({
      where,
      select: {
        readAt: true,
        archivedAt: true,
        createdAt: true,
        notification: {
          select: {
            id: true,
            type: true,
            category: true,
            severity: true,
            title: true,
            message: true,
            relatedPath: true,
            entityType: true,
            entityId: true,
            sourceType: true,
            sourceId: true,
            metadata: true,
            triggeredAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { notification: { triggeredAt: 'desc' } },
        { createdAt: 'desc' },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notificationRecipient.count({
      where: {
        contaId: params.contaId,
        userId: params.userId,
        archivedAt: null,
        readAt: null,
        deletedAt: null,
      },
    }),
    prisma.notificationRecipient.count({ where }),
  ]);

  return {
    items: await enrichFinancialNotificationItems({
      contaId: params.contaId,
      items: recipients.map(serializeNotificationItem),
    }),
    unreadCount,
    totalCount,
  };
}

export async function getUnreadNotificationCount(params: {
  contaId: string;
  userId: string;
}): Promise<number> {
  return withDatabaseRetry(() => prisma.notificationRecipient.count({
    where: {
      contaId: params.contaId,
      userId: params.userId,
      archivedAt: null,
      readAt: null,
      deletedAt: null,
    },
  }));
}

async function enrichFinancialNotificationItems(params: {
  contaId: string;
  items: NotificationListItem[];
}): Promise<NotificationListItem[]> {
  const { contaId, items } = params;
  const financialItems = items.filter(
    (item) =>
      (item.category === NotificationCategory.BILLING || item.category === NotificationCategory.PAYMENT)
      && typeof item.sourceId === 'string'
      && item.sourceId.trim().length > 0
      && extractWebhookEventName(item.metadata) !== null,
  );

  if (financialItems.length === 0) {
    return items;
  }

  const sourceIds = Array.from(new Set(financialItems.map((item) => item.sourceId as string)));

  const [cobrancas, charges] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        asaasPaymentId: { in: sourceIds },
        matricula: { aluno: { contaId } },
      },
      select: {
        asaasPaymentId: true,
        valor: true,
        vencimento: true,
        descricao: true,
        formaPagamento: true,
        matricula: {
          select: {
            aluno: {
              select: {
                nome: true,
              },
            },
          },
        },
      },
    }),
    prisma.charge.findMany({
      where: { contaId, asaasPaymentId: { in: sourceIds } },
      select: {
        id: true,
        asaasPaymentId: true,
        value: true,
        dueDate: true,
        description: true,
        payerName: true,
        billingType: true,
      },
    }),
  ]);

  const cobrancaMap = new Map(cobrancas.map((item) => [item.asaasPaymentId, item]));
  const chargeMap = new Map(charges.map((item) => [item.asaasPaymentId, item]));

  return Promise.all(items.map(async (item) => {
    const eventName = extractWebhookEventName(item.metadata);
    if (!eventName || !item.sourceId) {
      return item;
    }

    const cobranca = cobrancaMap.get(item.sourceId);
    if (cobranca) {
      const content = resolveBillingNotificationContent({
        eventName,
        formaPagamento: cobranca.formaPagamento,
        alunoNome: cobranca.matricula.aluno.nome,
        dueDate: cobranca.vencimento,
        value: Number(cobranca.valor),
        description: cobranca.descricao,
        originLabel: cobranca.descricao?.trim() || 'cobrança acadêmica',
      });

      return {
        ...item,
        type: content.type,
        category: content.category,
        severity: content.severity,
        title: content.title,
        message: content.message,
      };
    }

    const charge = chargeMap.get(item.sourceId);
    if (!charge) {
      return item;
    }

    const origin = extractBillingOriginContext(item.metadata);
    if (!origin) return item;
    const content = resolveBillingNotificationContent({
      eventName,
      billingType: charge.billingType,
      payerName: charge.payerName,
      dueDate: charge.dueDate,
      value: charge.value ? Number(charge.value) : null,
      description: charge.description,
      originLabel: origin.originLabel,
      planId: origin.planId,
      planBillingType: origin.planBillingType,
      planValue: origin.planValue,
      planInstallmentCount: origin.planInstallmentCount,
      installmentPosition: origin.installmentPosition,
    });

    return {
      ...item,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
    };
  }));
}
