import {
  EventTicketWhatsAppNotificationStatus,
  EventTicketWhatsAppPurchaseType,
} from '@prisma/client';
import {
  normalizeBrazilianWhatsAppPhone,
  sanitizeWhatsAppError,
  type WhatsAppMessageRequest,
} from '@alusa/whatsapp';
import { isTicketPaymentBlocked } from '@alusa/domain/events';

import { prisma } from '@/prisma/client';
import { getWhatsAppRuntimeConfig, assertWhatsAppConfigured } from '@/src/server/whatsapp/config';
import { enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';

const LEASE_TIMEOUT_MS = 10 * 60_000;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 60 * 60_000;
const CONSENT_VERSION = 'event-ticket-whatsapp-v1';

type DrainResult = {
  claimed: number;
  queued: number;
  retried: number;
  deadLettered: number;
  skipped: number;
  paused: boolean;
};

function buildPublicTicketUrlPrefix() {
  const baseUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!baseUrl) throw new Error('EVENT_TICKET_PUBLIC_URL_UNAVAILABLE');
  const prefix = new URL('/api/public/event-ticket-links/', baseUrl);
  if (prefix.protocol !== 'https:') throw new Error('EVENT_TICKET_PUBLIC_URL_MUST_BE_HTTPS');

  const configuredPrefix = process.env.WHATSAPP_EVENT_TICKET_URL_PREFIX?.trim();
  if (!configuredPrefix) throw new Error('WHATSAPP_EVENT_TICKET_URL_PREFIX_UNAVAILABLE');
  const configured = new URL(configuredPrefix);
  if (configured.href !== prefix.href) throw new Error('WHATSAPP_EVENT_TICKET_URL_PREFIX_MISMATCH');
  return prefix;
}

function buildTemplateRequest(input: {
  recipientPhone: string;
  buyerName: string;
  eventName: string;
  accessToken: string;
  templateName: string;
  languageCode: string;
}): WhatsAppMessageRequest {
  // The approved Meta template must use this exact dynamic URL prefix and one
  // trailing URL variable. Only the opaque capability token is sent as suffix.
  buildPublicTicketUrlPrefix();
  return {
    kind: 'template',
    to: normalizeBrazilianWhatsAppPhone(input.recipientPhone),
    templateName: input.templateName,
    languageCode: input.languageCode,
    components: [
      { type: 'body', parameters: [
        { type: 'text', text: input.buyerName },
        { type: 'text', text: input.eventName },
      ] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: input.accessToken }] },
    ],
  };
}

async function loadEligiblePurchase(notification: {
  contaId: string;
  purchaseType: EventTicketWhatsAppPurchaseType;
  eventMapOrderId: string | null;
  eventTicketSaleId: string | null;
  recipientPhone: string;
  consentVersion: string | null;
  consentRecordedAt: Date | null;
  consentSource: string | null;
}) {
  if (
    notification.consentVersion !== CONSENT_VERSION ||
    !notification.consentRecordedAt ||
    !notification.consentSource
  ) return { kind: 'SKIP' as const, reason: 'CONSENT_NOT_RECORDED' };

  if (notification.purchaseType === EventTicketWhatsAppPurchaseType.PUBLIC_ORDER && notification.eventMapOrderId) {
    const order = await prisma.eventMapOrder.findFirst({
      where: { id: notification.eventMapOrderId, contaId: notification.contaId },
      select: {
        id: true, status: true, paymentStatus: true, ticketFulfillmentStatus: true,
        buyerName: true, buyerPhone: true, whatsappOptInAt: true, whatsappOptInSource: true, whatsappOptOutAt: true,
        accessToken: true, event: { select: { name: true } }, map: { select: { name: true } },
        items: { select: { ticket: { select: { id: true, status: true } } } },
      },
    });
    if (!order || order.status !== 'CONFIRMED' || isTicketPaymentBlocked(order.paymentStatus)) {
      return { kind: 'SKIP' as const, reason: 'ORDER_NOT_SENDABLE' };
    }
    if (order.ticketFulfillmentStatus !== 'ISSUED' || order.items.some((item) => !item.ticket || !['VALID', 'USED'].includes(item.ticket.status))) {
      return { kind: 'RETRY' as const, reason: 'TICKETS_NOT_ISSUED' };
    }
    if (!order.buyerPhone || !order.whatsappOptInAt || order.whatsappOptOutAt || order.whatsappOptInSource !== 'PUBLIC_CHECKOUT' || order.buyerPhone !== notification.recipientPhone) {
      return { kind: 'SKIP' as const, reason: 'RECIPIENT_OR_CONSENT_CHANGED' };
    }
    return {
      kind: 'SEND' as const,
      buyerName: order.buyerName,
      eventName: `${order.event.name} · ${order.map.name}`,
      recipientPhone: order.buyerPhone,
      accessToken: order.accessToken,
    };
  }

  if (notification.purchaseType === EventTicketWhatsAppPurchaseType.STAFF_SALE && notification.eventTicketSaleId) {
    const sale = await prisma.eventTicketSale.findFirst({
      where: { id: notification.eventTicketSaleId, contaId: notification.contaId },
      select: {
        id: true, status: true, buyerName: true, buyerPhone: true,
        whatsappOptInAt: true, whatsappOptInSource: true, whatsappOptOutAt: true, accessToken: true, quantity: true,
        event: { select: { name: true } },
        saleSeats: { take: 1, select: { publicSeat: { select: { map: { select: { name: true } } } } } },
        tickets: { where: { status: { in: ['VALID', 'USED'] } }, select: { id: true } },
      },
    });
    if (!sale || sale.status !== 'PAID') return { kind: 'SKIP' as const, reason: 'SALE_NOT_PAID' };
    if (sale.tickets.length !== sale.quantity) return { kind: 'RETRY' as const, reason: 'TICKETS_NOT_ISSUED' };
    if (!sale.buyerPhone || !sale.whatsappOptInAt || sale.whatsappOptOutAt || sale.whatsappOptInSource !== 'STAFF_SALE' || sale.buyerPhone !== notification.recipientPhone) {
      return { kind: 'SKIP' as const, reason: 'RECIPIENT_OR_CONSENT_CHANGED' };
    }
    const sessionName = sale.saleSeats[0]?.publicSeat.map.name;
    return {
      kind: 'SEND' as const,
      buyerName: sale.buyerName,
      eventName: sessionName ? `${sale.event.name} · ${sessionName}` : sale.event.name,
      recipientPhone: sale.buyerPhone,
      accessToken: sale.accessToken,
    };
  }

  return { kind: 'SKIP' as const, reason: 'PURCHASE_REFERENCE_INVALID' };
}

export async function drainEventTicketWhatsAppNotifications(input: { limit?: number; contaId?: string; notificationId?: string } = {}): Promise<DrainResult> {
  if (input.notificationId && !input.contaId) throw new Error('TENANT_SCOPE_REQUIRED_FOR_NOTIFICATION');
  const runtime = getWhatsAppRuntimeConfig();
  const result: DrainResult = { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0, paused: !runtime.enabled };
  if (!runtime.enabled) return result;
  assertWhatsAppConfigured(runtime);

  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const workerId = `event-ticket-whatsapp-${process.pid}-${Date.now()}`;
  const now = new Date();

  await prisma.eventTicketWhatsAppNotification.updateMany({
    where: {
      status: EventTicketWhatsAppNotificationStatus.PROCESSING,
      lockedAt: { lt: new Date(now.getTime() - LEASE_TIMEOUT_MS) },
      ...(input.contaId ? { contaId: input.contaId } : {}),
      ...(input.notificationId ? { id: input.notificationId } : {}),
    },
    data: {
      status: EventTicketWhatsAppNotificationStatus.FAILED,
      nextAttemptAt: now,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: 'STALE_LOCK_RECOVERED',
    },
  });
  await prisma.eventTicketWhatsAppNotification.updateMany({
    where: {
      status: EventTicketWhatsAppNotificationStatus.FAILED,
      attempts: { gte: 8 },
      ...(input.contaId ? { contaId: input.contaId } : {}),
      ...(input.notificationId ? { id: input.notificationId } : {}),
    },
    data: { status: EventTicketWhatsAppNotificationStatus.DLQ, processedAt: now, lockedAt: null, lockedBy: null },
  });

  const candidates = await prisma.eventTicketWhatsAppNotification.findMany({
    where: {
      status: { in: [EventTicketWhatsAppNotificationStatus.PENDING, EventTicketWhatsAppNotificationStatus.FAILED] },
      nextAttemptAt: { lte: now },
      attempts: { lt: 8 },
      ...(input.contaId ? { contaId: input.contaId } : {}),
      ...(input.notificationId ? { id: input.notificationId } : {}),
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true, contaId: true, whatsappJobId: true },
  });

  for (const candidate of candidates) {
    if (candidate.whatsappJobId) {
      const linkedJob = await prisma.whatsAppOutboundJob.findFirst({
        where: { id: candidate.whatsappJobId, contaId: candidate.contaId },
        select: { status: true },
      });
      // A delivery receipt failure is terminal for this message. The existing
      // idempotency key points at a SENT job, so automatic retry cannot resend it.
      if (linkedJob?.status === 'SENT' || linkedJob?.status === 'DLQ') continue;
    }
    const claimed = await prisma.eventTicketWhatsAppNotification.updateMany({
      where: {
        id: candidate.id,
        contaId: candidate.contaId,
        status: { in: [EventTicketWhatsAppNotificationStatus.PENDING, EventTicketWhatsAppNotificationStatus.FAILED] },
        nextAttemptAt: { lte: new Date() },
      },
      data: {
        status: EventTicketWhatsAppNotificationStatus.PROCESSING,
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    const notification = await prisma.eventTicketWhatsAppNotification.findUnique({ where: { id: candidate.id, contaId: candidate.contaId } });
    if (!notification) continue;

    try {
      const purchase = await loadEligiblePurchase(notification);
      if (purchase.kind === 'SKIP') {
        await prisma.eventTicketWhatsAppNotification.updateMany({
          where: { id: notification.id, contaId: notification.contaId, status: EventTicketWhatsAppNotificationStatus.PROCESSING, lockedBy: workerId },
          data: { status: EventTicketWhatsAppNotificationStatus.SKIPPED, processedAt: new Date(), lockedAt: null, lockedBy: null, lastErrorCode: purchase.reason },
        });
        result.skipped += 1;
        continue;
      }
      if (purchase.kind === 'RETRY') throw new Error(purchase.reason);
      const accessToken = purchase.accessToken;
      if (!accessToken) throw new Error('TICKET_ACCESS_TOKEN_UNAVAILABLE');

      const request = buildTemplateRequest({
        buyerName: purchase.buyerName,
        eventName: purchase.eventName,
        recipientPhone: purchase.recipientPhone,
        accessToken,
        templateName: notification.templateName,
        languageCode: notification.languageCode,
      });
      const queued = await enqueueWhatsAppMessage({
        contaId: notification.contaId,
        request,
        idempotencyKey: `event-ticket-template:${runtime.phoneNumberId}:${notification.id}`,
        correlationId: notification.correlationId,
      });
      if (queued.status === 'SENT' || queued.status === 'DLQ') {
        await prisma.eventTicketWhatsAppNotification.updateMany({
          where: { id: notification.id, contaId: notification.contaId, status: EventTicketWhatsAppNotificationStatus.PROCESSING, lockedBy: workerId },
          data: {
            status: EventTicketWhatsAppNotificationStatus.FAILED,
            whatsappJobId: queued.jobId,
            processedAt: null,
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: notification.lastErrorCode ?? 'DELIVERY_FAILED',
          },
        });
        continue;
      }
      const updated = await prisma.eventTicketWhatsAppNotification.updateMany({
        where: { id: notification.id, contaId: notification.contaId, status: EventTicketWhatsAppNotificationStatus.PROCESSING, lockedBy: workerId },
        data: {
          status: EventTicketWhatsAppNotificationStatus.QUEUED,
          whatsappJobId: queued.jobId,
          processedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
          lastError: null,
        },
      });
      if (updated.count !== 1) throw new Error('NOTIFICATION_LEASE_LOST');
      result.queued += 1;
    } catch (error) {
      const sanitized = sanitizeWhatsAppError(error);
      const attempts = notification.attempts;
      const permanentCodes = [
        'EVENT_TICKET_PUBLIC_URL_UNAVAILABLE',
        'EVENT_TICKET_PUBLIC_URL_MUST_BE_HTTPS',
        'WHATSAPP_EVENT_TICKET_URL_PREFIX_UNAVAILABLE',
        'WHATSAPP_EVENT_TICKET_URL_PREFIX_MISMATCH',
        'TICKET_ACCESS_TOKEN_UNAVAILABLE',
      ];
      const permanentCode = error instanceof Error
        ? permanentCodes.find((code) => error.message === code)
        : undefined;
      const permanent = Boolean(permanentCode);
      const deadLetter = permanent || attempts >= notification.maxAttempts;
      const nextAttemptAt = new Date(Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1)));
      await prisma.eventTicketWhatsAppNotification.updateMany({
        where: { id: notification.id, contaId: notification.contaId, status: EventTicketWhatsAppNotificationStatus.PROCESSING, lockedBy: workerId },
        data: {
          status: deadLetter ? EventTicketWhatsAppNotificationStatus.DLQ : EventTicketWhatsAppNotificationStatus.FAILED,
          nextAttemptAt,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: permanentCode ?? sanitized.code,
          lastError: sanitized.message,
          ...(deadLetter ? { processedAt: new Date() } : {}),
        },
      });
      if (deadLetter) result.deadLettered += 1;
      else result.retried += 1;
    }
  }

  return result;
}

/** Post-commit targeted dispatch. Cron remains responsible for recovery/retries. */
export async function dispatchEventTicketWhatsAppNotification(input: { contaId: string; notificationId: string }) {
  await drainEventTicketWhatsAppNotifications({ ...input, limit: 1 });
  const notification = await prisma.eventTicketWhatsAppNotification.findFirst({
    where: { id: input.notificationId, contaId: input.contaId },
    select: { status: true, whatsappJobId: true },
  });
  if (notification?.whatsappJobId) {
    const { drainWhatsAppOutbox } = await import('@/src/server/whatsapp/outbox.service');
    await drainWhatsAppOutbox({ limit: 1, contaId: input.contaId, jobId: notification.whatsappJobId });
  }
  return notification?.status ?? null;
}

export async function dispatchPublicOrderTicketWhatsAppNotification(input: { orderId: string; accessToken: string }) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: input.orderId, accessToken: input.accessToken },
    select: { id: true, contaId: true },
  });
  if (!order) return null;
  const notification = await prisma.eventTicketWhatsAppNotification.findFirst({
    where: {
      contaId: order.contaId,
      eventMapOrderId: order.id,
      status: { in: [EventTicketWhatsAppNotificationStatus.PENDING, EventTicketWhatsAppNotificationStatus.FAILED] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!notification) return null;
  return dispatchEventTicketWhatsAppNotification({ contaId: order.contaId, notificationId: notification.id });
}
