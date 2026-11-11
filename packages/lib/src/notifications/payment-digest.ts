import { NotificationSeverity, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import { isInternalNotificationTypeAllowed } from './notification-policy';
import { formatCurrency } from './notification-content';
import type { WebhookNotificationEvent } from './notification-content';
import type { CreateNotificationInput, CreateNotificationResult } from './notification-types';
import { resolveRecipientUserIds } from './notification-write';

export type PaymentDigestEntry = {
  asaasPaymentId: string;
  subject: string;
  value: number | null;
  description: string | null;
  paymentMethod?: string | null;
  originLabel?: string | null;
  relatedPath?: string | null;
  planId?: string | null;
  planBillingType?: string | null;
  planValue?: number | null;
  planInstallmentCount?: number | null;
  installmentPosition?: number | null;
};

export const PAYMENT_DIGEST_EVENTS = new Set<WebhookNotificationEvent>([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
]);
const PAYMENT_DIGEST_WINDOW_MS = 15 * 60 * 1000;
const PAYMENT_DIGEST_MAX_ITEMS = 20;

export function buildPaymentDigestDedupeKey(eventName: WebhookNotificationEvent, occurredAt?: Date) {
  const group = eventName === 'PAYMENT_RECEIVED_IN_CASH' ? 'cash' : 'confirmed';
  const timestamp = occurredAt?.getTime() ?? Date.now();
  const bucket = Math.floor(timestamp / PAYMENT_DIGEST_WINDOW_MS) * PAYMENT_DIGEST_WINDOW_MS;
  return `payment:${group}:digest:${bucket}`;
}

export function buildPaymentDigestEventKey(eventName: WebhookNotificationEvent, asaasPaymentId: string) {
  const group = eventName === 'PAYMENT_RECEIVED_IN_CASH' ? 'cash' : 'confirmed';
  return `payment:${group}:${asaasPaymentId}`;
}

function parsePaymentDigestEntries(metadata: Prisma.JsonValue | null | undefined): PaymentDigestEntry[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const payments = 'payments' in metadata ? metadata.payments : null;
  if (!Array.isArray(payments)) return [];

  return payments.filter((payment): payment is PaymentDigestEntry => {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return false;
    return (
      typeof payment.asaasPaymentId === 'string'
      && typeof payment.subject === 'string'
      && (typeof payment.value === 'number' || payment.value === null)
      && (typeof payment.description === 'string' || payment.description === null)
      && (payment.paymentMethod === undefined || payment.paymentMethod === null || typeof payment.paymentMethod === 'string')
    );
  });
}

function buildPaymentDigestMessage(entries: PaymentDigestEntry[]) {
  const isCardPlan = (entry: PaymentDigestEntry) => ['CREDIT_CARD', 'CARTAO_CREDITO'].includes(entry.planBillingType?.toUpperCase() ?? '');
  const getContext = (entry: PaymentDigestEntry) => {
    const origin = entry.originLabel?.trim();
    const rawDetail = entry.description?.trim();
    const detail = entry.planId && rawDetail
      ? rawDetail.replace(/^parcela\s+(?:\d+\s+de\s+\d+|\d+\s*\/\s*\d+)\s*(?:[-–—.:|,]\s*)?/i, '').trim()
      : rawDetail;
    if (!origin) return detail ?? '';
    const normalizeContext = (value: string) => value
      .toLocaleLowerCase('pt-BR')
      .replace(/\bevento\b/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const normalizedOrigin = normalizeContext(origin);
    const normalizedDetail = detail ? normalizeContext(detail) : '';
    const detailRepeatsOrigin = normalizedDetail === normalizedOrigin ||
      normalizedDetail.includes(normalizedOrigin) || normalizedOrigin.includes(normalizedDetail);
    return detail && detail !== origin && normalizedDetail && !detailRepeatsOrigin
      ? `${origin}, ${detail}`
      : origin;
  };
  const line = (entry: PaymentDigestEntry) => {
    const cardPlan = entry.planId && isCardPlan(entry);
    const value = formatCurrency(cardPlan ? entry.planValue : entry.value);
    const context = getContext(entry);
    const method = entry.paymentMethod?.trim().toUpperCase();
    const methodLabel = method === 'CASH' || method === 'DINHEIRO'
      ? 'em dinheiro'
      : method === 'PIX'
        ? 'via Pix'
        : method === 'BOLETO'
          ? 'via boleto'
          : method === 'CREDIT_CARD' || method === 'CARTAO_CREDITO'
            ? 'no cartão'
            : method === 'MANUAL_PIX'
              ? 'por Pix registrado manualmente'
              : method === 'EXTERNAL_CARD'
                ? 'no cartão'
            : '';
    if (cardPlan) {
      return `${entry.subject} pagou ${context ? `a ${context}` : 'a compra'}${value ? `, no valor total de ${value}` : ''} em ${entry.planInstallmentCount} vezes no cartão`;
    }
    const installment = entry.planId && entry.planInstallmentCount && entry.planInstallmentCount > 1
      ? entry.installmentPosition
        ? `a parcela ${entry.installmentPosition} de ${entry.planInstallmentCount} da ${context || 'cobrança'}`
        : `a cobrança do plano com ${entry.planInstallmentCount} cobranças${context ? `, referente a ${context}` : ''}`
      : '';
    if (installment.startsWith('a parcela')) {
      return `${entry.subject} pagou ${installment}${value ? `, no valor de ${value}` : ''}${methodLabel ? ` ${methodLabel}` : ''}`;
    }
    if (installment) {
      return `${entry.subject} pagou ${installment}${value ? `, no valor de ${value}` : ''}${methodLabel ? ` ${methodLabel}` : ''}`;
    }
    return `${entry.subject} pagou${value ? ` ${value}` : ''}${context ? `, referente a ${context}` : ''}${methodLabel ? ` ${methodLabel}` : ''}`;
  };
  if (entries.length === 1) {
    return `${line(entries[0])}.`;
  }

  const lines = entries.slice(0, PAYMENT_DIGEST_MAX_ITEMS).map((entry) => `${line(entry)}.`);
  return `Pagamentos recebidos:\n${lines.join('\n')}`;
}

export async function createPaymentDigestNotification(params: {
  input: CreateNotificationInput;
  payment: PaymentDigestEntry;
  eventKey: string;
}): Promise<CreateNotificationResult> {
  const { input, payment, eventKey } = params;
  if (!isInternalNotificationTypeAllowed(input.type)) {
    return { notificationId: null, created: false, recipientCount: 0, reason: 'policy_excluded' };
  }

  return prisma.$transaction(async (tx) => {
    const stableCardPlanEventKey = payment.planId &&
      ['CREDIT_CARD', 'CARTAO_CREDITO'].includes(payment.planBillingType?.toUpperCase() ?? '') &&
      eventKey.startsWith('payment:confirmed:')
      ? `payment:card-plan:${payment.planId}`
      : null;
    if (stableCardPlanEventKey) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-digest-plan:${input.contaId}:${payment.planId}`}, 0))`;
    }

    const recipientUserIds = await resolveRecipientUserIds(tx, input, input.actor);
    if (recipientUserIds.length === 0) {
      logInboxMetric('inbox.skipped.no_recipients', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
      });
      return { notificationId: null, created: false, recipientCount: 0, reason: 'no_recipients' };
    }

    const alreadyProcessed = await tx.notificationDigestEvent.findUnique({
      where: {
        uq_notification_digest_event_conta_event: {
          contaId: input.contaId,
          eventKey,
        },
      },
      select: { notificationId: true },
    });

    if (alreadyProcessed) {
      await tx.notificationRecipient.createMany({
        data: recipientUserIds.map((userId) => ({
          notificationId: alreadyProcessed.notificationId,
          contaId: input.contaId,
          userId,
        })),
        skipDuplicates: true,
      });
      logInboxMetric('inbox.deduped', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
        grouped: true,
      });
      return {
        notificationId: alreadyProcessed.notificationId,
        created: false,
        recipientCount: recipientUserIds.length,
      };
    }

    if (stableCardPlanEventKey) {
      const existingPlanDigest = await tx.notificationDigestEvent.findUnique({
        where: {
          uq_notification_digest_event_conta_event: {
            contaId: input.contaId,
            eventKey: stableCardPlanEventKey,
          },
        },
        select: { notificationId: true },
      });
      if (existingPlanDigest) {
        await tx.notificationDigestEvent.createMany({
          data: [{ notificationId: existingPlanDigest.notificationId, contaId: input.contaId, eventKey }],
          skipDuplicates: true,
        });
        await tx.notificationRecipient.createMany({
          data: recipientUserIds.map((userId) => ({
            notificationId: existingPlanDigest.notificationId,
            contaId: input.contaId,
            userId,
          })),
          skipDuplicates: true,
        });
        logInboxMetric('inbox.deduped', {
          contaId: input.contaId,
          dedupeKey: input.dedupeKey,
          type: input.type,
          grouped: true,
          stableCardPlan: true,
        });
        return {
          notificationId: existingPlanDigest.notificationId,
          created: false,
          recipientCount: recipientUserIds.length,
        };
      }
    }

    const existing = await tx.notification.findUnique({
      where: { contaId_dedupeKey: { contaId: input.contaId, dedupeKey: input.dedupeKey } },
      select: { id: true, metadata: true },
    });

    let notification = existing;
    let created = false;
    if (!notification) {
      const createResult = await tx.notification.createMany({
        data: {
          contaId: input.contaId,
          type: input.type,
          category: input.category,
          severity: input.severity ?? NotificationSeverity.SUCCESS,
          title: input.title,
          message: buildPaymentDigestMessage([payment]),
          dedupeKey: input.dedupeKey,
          relatedPath: payment.relatedPath ?? input.relatedPath ?? '/financeiro/pagamentos',
          entityType: 'PaymentDigest',
          entityId: input.dedupeKey,
          sourceType: 'INBOX_DIGEST',
          sourceId: null,
          actorType: input.actor?.type,
          actorId: input.actor?.id ?? null,
          metadata: {
            ...(typeof input.metadata === 'object' && input.metadata && !Array.isArray(input.metadata)
              ? input.metadata
              : {}),
            grouped: true,
            groupType: 'PAYMENT_CONFIRMATION',
            paymentCount: 1,
            payments: [payment],
          },
          triggeredAt: input.triggeredAt ?? new Date(),
        },
        skipDuplicates: true,
      });
      created = createResult.count > 0;
      notification = await tx.notification.findUnique({
        where: { contaId_dedupeKey: { contaId: input.contaId, dedupeKey: input.dedupeKey } },
        select: { id: true, metadata: true },
      });
    }

    if (!notification) {
      // The key is unique per tenant; a failed resolution here means the transaction
      // could not safely determine the notification recipient.
      throw new Error(`Falha ao resolver digest de pagamento ${input.dedupeKey}`);
    }

    const digestEvent = await tx.notificationDigestEvent.createMany({
      data: [
        {
          notificationId: notification.id,
          contaId: input.contaId,
          eventKey,
        },
        ...(stableCardPlanEventKey ? [{
          notificationId: notification.id,
          contaId: input.contaId,
          eventKey: stableCardPlanEventKey,
        }] : []),
      ],
      skipDuplicates: true,
    });

    if (digestEvent.count === 0) {
      logInboxMetric('inbox.deduped', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
        grouped: true,
      });
      return {
        notificationId: notification.id,
        created: false,
        recipientCount: recipientUserIds.length,
      };
    }

    const previousEntries = parsePaymentDigestEntries(notification.metadata);
    const alreadyIncluded = previousEntries.some((entry) => entry.asaasPaymentId === payment.asaasPaymentId);
    const cardPlanAlreadyPresent = Boolean(
      payment.planId && ['CREDIT_CARD', 'CARTAO_CREDITO'].includes(payment.planBillingType?.toUpperCase() ?? '') &&
      previousEntries.some((entry) => entry.planId === payment.planId),
    );
    const entries = alreadyIncluded || cardPlanAlreadyPresent
      ? previousEntries
      : [...previousEntries, payment].slice(-PAYMENT_DIGEST_MAX_ITEMS);

    if (!created && !alreadyIncluded && !cardPlanAlreadyPresent) {
      await tx.notification.update({
        where: { id: notification.id },
        data: {
          title: input.title,
          message: buildPaymentDigestMessage(entries),
          relatedPath: entries.length > 1
            ? '/financeiro/pagamentos'
            : entries[0]?.relatedPath ?? input.relatedPath ?? '/financeiro/pagamentos',
          metadata: {
            ...(typeof input.metadata === 'object' && input.metadata && !Array.isArray(input.metadata)
              ? input.metadata
              : {}),
            grouped: true,
            groupType: 'PAYMENT_CONFIRMATION',
            paymentCount: previousEntries.length + 1,
            payments: entries,
          },
          triggeredAt: input.triggeredAt ?? new Date(),
        },
      });
      await tx.notificationRecipient.updateMany({
        where: {
          notificationId: notification.id,
          contaId: input.contaId,
          userId: { in: recipientUserIds },
          deletedAt: null,
        },
        data: { readAt: null, archivedAt: null },
      });
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
        grouped: true,
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
            severity: input.severity ?? NotificationSeverity.SUCCESS,
            dedupeKey: input.dedupeKey,
            recipientCount: recipientUserIds.length,
            grouped: true,
          },
        },
      });
    } else if (alreadyIncluded) {
      logInboxMetric('inbox.deduped', {
        contaId: input.contaId,
        dedupeKey: input.dedupeKey,
        type: input.type,
        grouped: true,
      });
    }

    return {
      notificationId: notification.id,
      created,
      recipientCount: recipientUserIds.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
