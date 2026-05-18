import { prisma, type Prisma } from '../prisma';
import { logInboxMetric } from '../notifications/inbox-metrics';
import {
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
  Role,
  Status,
  type AuditActorType,
} from '@prisma/client';

const DEFAULT_RECIPIENT_ROLES: Role[] = ['ADMIN', 'FINANCEIRO', 'RECEPCAO'];
const ACTIVE_VIEW = 'active';
const ARCHIVED_VIEW = 'archived';

export type NotificationFeedView = typeof ACTIVE_VIEW | typeof ARCHIVED_VIEW | 'all';
export interface NotificationActor {
  type: AuditActorType;
  id?: string | null;
}

export interface CreateNotificationInput {
  contaId: string;
  type: NotificationType;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  dedupeKey: string;
  relatedPath?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
  actor?: NotificationActor;
  recipientUserIds?: string[];
  recipientRoles?: Role[];
  triggeredAt?: Date;
}

export interface NotificationListItem {
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
  readAt: Date | null;
  archivedAt: Date | null;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  unreadCount: number;
  totalCount: number;
}

export interface CreateNotificationResult {
  notificationId: string | null;
  created: boolean;
  recipientCount: number;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatCurrency(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function buildRecipientWhere(view: NotificationFeedView): Prisma.NotificationRecipientWhereInput {
  if (view === ARCHIVED_VIEW) {
    return { archivedAt: { not: null } };
  }
  if (view === ACTIVE_VIEW) {
    return { archivedAt: null };
  }
  return {};
}

async function resolveRecipientUserIds(
  tx: Prisma.TransactionClient,
  input: Pick<CreateNotificationInput, 'contaId' | 'recipientUserIds' | 'recipientRoles'>,
): Promise<string[]> {
  if (input.recipientUserIds && input.recipientUserIds.length > 0) {
    return uniq(input.recipientUserIds);
  }

  const roles = input.recipientRoles && input.recipientRoles.length > 0
    ? input.recipientRoles
    : DEFAULT_RECIPIENT_ROLES;

  const users = await tx.usuario.findMany({
    where: {
      contaId: input.contaId,
      status: Status.ATIVO,
      role: { in: roles },
    },
    select: { id: true },
  });

  return users.map((user) => user.id);
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

function extractWebhookEventName(metadata: Prisma.JsonValue | null): WebhookNotificationEvent | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const eventName = 'webhookEvent' in metadata ? metadata.webhookEvent : null;
  if (typeof eventName !== 'string') {
    return null;
  }

  return isBillingNotificationEvent(eventName) ? eventName : null;
}

export async function createNotification(input: CreateNotificationInput): Promise<CreateNotificationResult> {
  return prisma.$transaction(async (tx) => {
    const recipientUserIds = await resolveRecipientUserIds(tx, input);
    if (recipientUserIds.length === 0) {
      console.info('[Notifications] Criação ignorada: nenhum destinatário elegível.', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
      });
      return {
        notificationId: null,
        created: false,
        recipientCount: 0,
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
      console.warn('[Notifications] dedupeKey já existente; reaproveitando notificação.', {
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
        console.warn('[Notifications] dedupeKey já existente; reaproveitando notificação.', {
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
      include: {
        notification: true,
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
      },
    }),
    prisma.notificationRecipient.count({ where }),
  ]);

  return {
    items: await enrichFinancialNotificationItems(recipients.map(serializeNotificationItem)),
    unreadCount,
    totalCount,
  };
}

export async function updateNotificationRecipientState(params: {
  contaId: string;
  userId: string;
  notificationId: string;
  action: 'read' | 'unread' | 'archive' | 'unarchive';
}): Promise<boolean> {
  const data: Prisma.NotificationRecipientUpdateManyMutationInput = {};

  if (params.action === 'read') {
    data.readAt = new Date();
  }
  if (params.action === 'unread') {
    data.readAt = null;
  }
  if (params.action === 'archive') {
    data.archivedAt = new Date();
    data.readAt = new Date();
  }
  if (params.action === 'unarchive') {
    data.archivedAt = null;
  }

  const result = await prisma.notificationRecipient.updateMany({
    where: {
      contaId: params.contaId,
      userId: params.userId,
      notificationId: params.notificationId,
    },
    data,
  });

  if (result.count > 0) {
    await prisma.auditLog.create({
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
}

export async function deleteNotificationRecipient(params: {
  contaId: string;
  userId: string;
  notificationId: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.notificationRecipient.deleteMany({
      where: {
        contaId: params.contaId,
        userId: params.userId,
        notificationId: params.notificationId,
      },
    });

    if (deleted.count === 0) {
      return false;
    }

    const remainingRecipients = await tx.notificationRecipient.count({
      where: {
        notificationId: params.notificationId,
      },
    });

    if (remainingRecipients === 0) {
      await tx.notification.deleteMany({
        where: {
          id: params.notificationId,
          contaId: params.contaId,
        },
      });
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
  const result = await prisma.notificationRecipient.updateMany({
    where: {
      contaId: params.contaId,
      userId: params.userId,
      archivedAt: null,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  if (result.count > 0) {
    await prisma.auditLog.create({
      data: {
        contaId: params.contaId,
        actorType: 'USER',
        actorId: params.userId,
        action: 'notification.read_all',
        entityType: 'Notification',
        metadata: {
          updatedCount: result.count,
        },
      },
    });
  }

  return result.count;
}

export async function createEnrollmentCreatedNotification(params: {
  contaId: string;
  matriculaId: string;
  actorUserId?: string | null;
}): Promise<CreateNotificationResult> {
  const matricula = await prisma.matricula.findFirst({
    where: {
      id: params.matriculaId,
      aluno: { contaId: params.contaId },
    },
    select: {
      id: true,
      alunoId: true,
      turmaId: true,
      planoId: true,
      comboId: true,
      aluno: {
        select: {
          nome: true,
        },
      },
      turma: {
        select: {
          nome: true,
        },
      },
      plano: {
        select: {
          nome: true,
        },
      },
      combo: {
        select: {
          nome: true,
        },
      },
    },
  });

  if (!matricula) {
    return { notificationId: null, created: false, recipientCount: 0 };
  }

  const offerName = matricula.plano?.nome ?? matricula.combo?.nome ?? null;
  const turmaName = matricula.turma?.nome ?? null;
  const detailParts = [
    offerName ? `plano ${offerName}` : null,
    turmaName ? `turma ${turmaName}` : null,
  ].filter(Boolean);
  const detail = detailParts.length > 0 ? ` em ${detailParts.join(' · ')}` : '';

  return createNotification({
    contaId: params.contaId,
    type: NotificationType.ENROLLMENT_CREATED,
    category: NotificationCategory.ENROLLMENT,
    severity: NotificationSeverity.INFO,
    title: 'Nova matrícula registrada',
    message: `${matricula.aluno.nome} foi matriculado${detail}.`,
    dedupeKey: `enrollment:created:${matricula.id}`,
    relatedPath: `/matriculas/${matricula.id}`,
    entityType: 'Matricula',
    entityId: matricula.id,
    sourceType: 'MATRICULA',
    sourceId: matricula.id,
    metadata: {
      alunoId: matricula.alunoId,
      planoId: matricula.planoId,
      comboId: matricula.comboId,
      turmaId: matricula.turmaId,
      alunoNome: matricula.aluno.nome,
      planoNome: offerName,
      turmaNome: turmaName,
    },
    actor: {
      type: params.actorUserId ? 'USER' : 'SYSTEM',
      id: params.actorUserId ?? null,
    },
  });
}

export const BILLING_NOTIFICATION_EVENT_ALIASES = {
  PAYMENT_DUNNING_RECEIVED: 'DUNNING_RECEIVED',
  PAYMENT_CHARGEBACK_DISPUTE: 'PAYMENT_CHARGEBACK_REQUESTED',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'PAYMENT_CHARGEBACK_REQUESTED',
} as const;

export const BILLING_NOTIFICATION_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
  'PAYMENT_CHARGEBACK_REQUESTED',
] as const;

export type WebhookNotificationEvent = (typeof BILLING_NOTIFICATION_EVENTS)[number];
export type BillingNotificationEventInput =
  | WebhookNotificationEvent
  | keyof typeof BILLING_NOTIFICATION_EVENT_ALIASES;

export function normalizeBillingNotificationEvent(eventName: string): WebhookNotificationEvent | null {
  const normalized = eventName in BILLING_NOTIFICATION_EVENT_ALIASES
    ? BILLING_NOTIFICATION_EVENT_ALIASES[eventName as keyof typeof BILLING_NOTIFICATION_EVENT_ALIASES]
    : eventName;

  return (BILLING_NOTIFICATION_EVENTS as readonly string[]).includes(normalized)
    ? (normalized as WebhookNotificationEvent)
    : null;
}

export function isBillingNotificationEvent(eventName: string): eventName is WebhookNotificationEvent {
  return normalizeBillingNotificationEvent(eventName) !== null;
}

export function buildBillingNotificationDedupeKey(
  eventName: WebhookNotificationEvent,
  asaasPaymentId: string,
): string {
  return `billing:${eventName}:${asaasPaymentId}`;
}

type BillingChannel = 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'CASH' | 'UNDEFINED';

function normalizeBillingChannel(params: {
  eventName: WebhookNotificationEvent;
  billingType?: string | null;
  formaPagamento?: string | null;
}): BillingChannel {
  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return 'CASH';
  }

  const raw = (params.billingType ?? params.formaPagamento ?? 'UNDEFINED').trim().toUpperCase();

  if (raw === 'PIX') return 'PIX';
  if (raw === 'BOLETO') return 'BOLETO';
  if (raw === 'CARTAO_CREDITO' || raw === 'CREDIT_CARD') return 'CREDIT_CARD';
  return 'UNDEFINED';
}

function mapWebhookEventToNotification(params: {
  eventName: WebhookNotificationEvent;
  billingChannel: BillingChannel;
}): {
  type: NotificationType;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
} {
  if (params.eventName === 'PAYMENT_CREATED') {
    return {
      type: NotificationType.BILLING_CREATED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.INFO,
      title:
        params.billingChannel === 'PIX'
          ? 'Pix disponível'
          : params.billingChannel === 'BOLETO'
            ? 'Boleto disponível'
            : params.billingChannel === 'CREDIT_CARD'
              ? 'Nova cobrança via cartão'
              : 'Nova cobrança',
    };
  }

  if (params.eventName === 'PAYMENT_OVERDUE') {
    return {
      type: NotificationType.BILLING_OVERDUE,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.WARNING,
      title: 'Cobrança vencida',
    };
  }

  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title: 'Pagamento recebido em espécie',
    };
  }

  if (params.eventName === 'PAYMENT_RECEIVED') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title:
        params.billingChannel === 'PIX'
          ? 'Pix recebido'
          : params.billingChannel === 'BOLETO'
            ? 'Boleto compensado'
            : 'Pagamento recebido',
    };
  }

  if (params.eventName === 'DUNNING_RECEIVED') {
    return {
      type: NotificationType.PAYMENT_CONFIRMED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.SUCCESS,
      title: 'Cobrança recuperada',
    };
  }

  if (params.eventName === 'PAYMENT_REFUNDED') {
    return {
      type: NotificationType.PAYMENT_REFUNDED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.WARNING,
      title: 'Cobrança estornada',
    };
  }

  if (params.eventName === 'PAYMENT_CHARGEBACK_REQUESTED') {
    return {
      type: NotificationType.PAYMENT_REFUNDED,
      category: NotificationCategory.PAYMENT,
      severity: NotificationSeverity.CRITICAL,
      title: 'Contestação de cobrança',
    };
  }

  if (params.eventName === 'PAYMENT_DELETED') {
    return {
      type: NotificationType.BILLING_CANCELLED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.WARNING,
      title: 'Cobrança excluída',
    };
  }

  if (params.eventName === 'PAYMENT_RESTORED') {
    return {
      type: NotificationType.BILLING_CREATED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.INFO,
      title: 'Cobrança reativada',
    };
  }

  // PAYMENT_CONFIRMED (fallback)
  return {
    type: NotificationType.PAYMENT_CONFIRMED,
    category: NotificationCategory.PAYMENT,
    severity: NotificationSeverity.SUCCESS,
    title:
      params.billingChannel === 'PIX'
        ? 'Pix confirmado'
        : params.billingChannel === 'BOLETO'
          ? 'Boleto confirmado'
          : params.billingChannel === 'CREDIT_CARD'
            ? 'Pagamento confirmado'
            : 'Pagamento confirmado',
  };
}

function buildBillingMessage(params: {
  eventName: WebhookNotificationEvent;
  billingChannel: BillingChannel;
  alunoNome?: string | null;
  payerName?: string | null;
  dueDate?: Date | null;
  value?: number | null;
  description?: string | null;
}): string {
  const subject = params.alunoNome ?? params.payerName ?? 'o responsável financeiro';
  const dueDate = formatDate(params.dueDate);
  const value = formatCurrency(params.value);
  const description = params.description?.trim() || null;

  if (params.eventName === 'PAYMENT_CREATED') {
    const chargeLabel =
      params.billingChannel === 'PIX'
        ? 'uma cobrança via Pix'
        : params.billingChannel === 'BOLETO'
          ? 'um boleto'
          : 'uma nova cobrança';

    return `${subject} recebeu ${chargeLabel}${description ? ` referente a ${description}` : ''}${dueDate ? ` com vencimento em ${dueDate}` : ''}${value ? ` no valor de ${value}` : ''}.`;
  }

  if (params.eventName === 'PAYMENT_OVERDUE') {
    return `A cobrança de ${subject}${dueDate ? ` com vencimento em ${dueDate}` : ''} está vencida. Acompanhe a situação financeira da matrícula.`;
  }

  if (params.eventName === 'PAYMENT_RECEIVED_IN_CASH') {
    return `O pagamento em espécie de ${subject}${value ? ` no valor de ${value}` : ''} foi registrado${description ? ` referente a ${description}` : ''}.`;
  }

  if (params.eventName === 'PAYMENT_RECEIVED') {
    if (params.billingChannel === 'PIX') {
      return `O Pix de ${subject}${value ? ` no valor de ${value}` : ''} foi recebido${description ? ` para ${description}` : ''}.`;
    }

    if (params.billingChannel === 'BOLETO') {
      return `O boleto de ${subject}${value ? ` no valor de ${value}` : ''} foi compensado${description ? ` para ${description}` : ''}.`;
    }

    return `O pagamento de ${subject}${value ? ` no valor de ${value}` : ''} foi recebido${description ? ` para ${description}` : ''}.`;
  }

  if (params.eventName === 'DUNNING_RECEIVED') {
    return `A cobrança de ${subject}${value ? ` no valor de ${value}` : ''} foi recuperada com sucesso${description ? ` referente a ${description}` : ''}.`;
  }

  if (params.eventName === 'PAYMENT_REFUNDED') {
    return `O pagamento de ${subject}${value ? ` no valor de ${value}` : ''}${description ? ` referente a ${description}` : ''} foi estornado. O valor será devolvido ao pagador.`;
  }

  if (params.eventName === 'PAYMENT_CHARGEBACK_REQUESTED') {
    return `Foi aberta uma contestação para o pagamento de ${subject}${value ? ` no valor de ${value}` : ''}${description ? ` referente a ${description}` : ''}. Acompanhe o caso financeiro da matrícula.`;
  }

  if (params.eventName === 'PAYMENT_DELETED') {
    return `A cobrança de ${subject}${value ? ` no valor de ${value}` : ''}${description ? ` referente a ${description}` : ''} foi excluída.`;
  }

  if (params.eventName === 'PAYMENT_RESTORED') {
    return `A cobrança de ${subject}${value ? ` no valor de ${value}` : ''}${description ? ` referente a ${description}` : ''} foi reativada${dueDate ? ` com vencimento em ${dueDate}` : ''}.`;
  }

  if (params.billingChannel === 'PIX') {
    return `O Pix de ${subject}${value ? ` no valor de ${value}` : ''} foi confirmado${description ? ` para ${description}` : ''}.`;
  }

  if (params.billingChannel === 'BOLETO') {
    return `O boleto de ${subject}${value ? ` no valor de ${value}` : ''} foi confirmado${description ? ` para ${description}` : ''}.`;
  }

  if (params.billingChannel === 'CREDIT_CARD') {
    return `O pagamento em cartão de crédito de ${subject}${value ? ` no valor de ${value}` : ''} foi confirmado${description ? ` para ${description}` : ''}.`;
  }

  return `O pagamento de ${subject}${value ? ` no valor de ${value}` : ''} foi confirmado${description ? ` para ${description}` : ''}.`;
}

export function resolveBillingNotificationContent(params: {
  eventName: WebhookNotificationEvent;
  billingType?: string | null;
  formaPagamento?: string | null;
  alunoNome?: string | null;
  payerName?: string | null;
  dueDate?: Date | null;
  value?: number | null;
  description?: string | null;
}) {
  const billingChannel = normalizeBillingChannel({
    eventName: params.eventName,
    billingType: params.billingType,
    formaPagamento: params.formaPagamento,
  });

  const mapped = mapWebhookEventToNotification({
    eventName: params.eventName,
    billingChannel,
  });

  return {
    ...mapped,
    message: buildBillingMessage({
      eventName: params.eventName,
      billingChannel,
      alunoNome: params.alunoNome,
      payerName: params.payerName,
      dueDate: params.dueDate,
      value: params.value,
      description: params.description,
    }),
  };
}

async function enrichFinancialNotificationItems(
  items: NotificationListItem[],
): Promise<NotificationListItem[]> {
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
      where: { asaasPaymentId: { in: sourceIds } },
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
      where: { asaasPaymentId: { in: sourceIds } },
      select: {
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

  return items.map((item) => {
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

    const content = resolveBillingNotificationContent({
      eventName,
      billingType: charge.billingType,
      payerName: charge.payerName,
      dueDate: charge.dueDate,
      value: charge.value ? Number(charge.value) : null,
      description: charge.description,
    });

    return {
      ...item,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
    };
  });
}

export async function createBillingWebhookNotification(params: {
  eventId?: string | null;
  eventName: BillingNotificationEventInput;
  asaasPaymentId: string;
  occurredAt?: Date;
  sourceType?: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
}): Promise<CreateNotificationResult> {
  const normalizedEvent = normalizeBillingNotificationEvent(params.eventName);
  if (!normalizedEvent) {
    console.info('[Notifications] Evento financeiro sem suporte para inbox interna.', {
      eventName: params.eventName,
      asaasPaymentId: params.asaasPaymentId,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    return { notificationId: null, created: false, recipientCount: 0 };
  }

  const cobranca = await prisma.cobranca.findUnique({
    where: { asaasPaymentId: params.asaasPaymentId },
    select: {
      id: true,
      matriculaId: true,
      valor: true,
      vencimento: true,
      descricao: true,
      formaPagamento: true,
      matricula: {
        select: {
          id: true,
          aluno: {
            select: {
              contaId: true,
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });

  if (cobranca) {
    const content = resolveBillingNotificationContent({
      eventName: normalizedEvent,
      formaPagamento: cobranca.formaPagamento,
      alunoNome: cobranca.matricula.aluno.nome,
      dueDate: cobranca.vencimento,
      value: Number(cobranca.valor),
      description: cobranca.descricao,
    });
    return createNotification({
      contaId: cobranca.matricula.aluno.contaId,
      type: content.type,
      category: content.category,
      severity: content.severity,
      title: content.title,
      message: content.message,
      dedupeKey: buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId),
      relatedPath: `/cobrancas/${cobranca.id}`,
      entityType: 'Cobranca',
      entityId: cobranca.id,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
      sourceId: params.asaasPaymentId,
      triggeredAt: params.occurredAt,
      metadata: {
        matriculaId: cobranca.matriculaId,
        alunoId: cobranca.matricula.aluno.id,
        alunoNome: cobranca.matricula.aluno.nome,
        asaasPaymentId: params.asaasPaymentId,
        webhookEvent: normalizedEvent,
        originalWebhookEvent: params.eventName,
        webhookEventId: params.eventId?.trim() || null,
        valor: Number(cobranca.valor),
        vencimento: cobranca.vencimento.toISOString(),
      },
      actor: {
        type: 'SYSTEM',
      },
    });
  }

  const charge = await prisma.charge.findUnique({
    where: { asaasPaymentId: params.asaasPaymentId },
    select: {
      id: true,
      contaId: true,
      value: true,
      dueDate: true,
      description: true,
      payerName: true,
      cobrancaId: true,
      billingType: true,
    },
  });

  if (!charge) {
    logInboxMetric('inbox.skipped.no_entity', {
      eventName: normalizedEvent,
      asaasPaymentId: params.asaasPaymentId,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    const pendingInbox = await import('../notifications/pending-inbox-notifications');
    await pendingInbox.enqueuePendingBillingWebhookNotification({
      eventId: params.eventId ?? null,
      eventName: normalizedEvent,
      asaasPaymentId: params.asaasPaymentId,
      occurredAt: params.occurredAt?.toISOString() ?? null,
      sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    });
    return { notificationId: null, created: false, recipientCount: 0 };
  }

  const content = resolveBillingNotificationContent({
    eventName: normalizedEvent,
    billingType: charge.billingType,
    payerName: charge.payerName,
    dueDate: charge.dueDate,
    value: charge.value ? Number(charge.value) : null,
    description: charge.description,
  });
  return createNotification({
    contaId: charge.contaId,
    type: content.type,
    category: content.category,
    severity: content.severity,
    title: content.title,
    message: content.message,
    dedupeKey: buildBillingNotificationDedupeKey(normalizedEvent, params.asaasPaymentId),
    relatedPath: charge.cobrancaId ? `/cobrancas/${charge.cobrancaId}` : '/cobrancas/avulsas',
    entityType: charge.cobrancaId ? 'Cobranca' : 'Charge',
    entityId: charge.cobrancaId ?? charge.id,
    sourceType: params.sourceType ?? 'ASAAS_WEBHOOK',
    sourceId: params.asaasPaymentId,
    triggeredAt: params.occurredAt,
    metadata: {
      chargeId: charge.id,
      payerName: charge.payerName,
      asaasPaymentId: params.asaasPaymentId,
      webhookEvent: normalizedEvent,
      originalWebhookEvent: params.eventName,
      webhookEventId: params.eventId?.trim() || null,
      valor: charge.value ? Number(charge.value) : null,
      vencimento: charge.dueDate?.toISOString() ?? null,
    },
    actor: {
      type: 'SYSTEM',
    },
  });
}
