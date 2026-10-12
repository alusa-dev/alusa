import { EventTicketWhatsAppPurchaseType, Prisma } from '@prisma/client';

export type EventTicketWhatsAppNotificationInput = {
  contaId: string;
  purchaseType: EventTicketWhatsAppPurchaseType;
  purchaseId: string;
  recipientPhone: string;
  templateName?: string;
  languageCode?: string;
  consentVersion?: string | null;
  consentSource?: string | null;
  consentRecordedAt?: Date | null;
  deliveryKey?: string;
  actorUserId?: string | null;
};

export function buildPublicEventTicketWhatsAppPath(accessToken: string) {
  return `/api/public/event-ticket-links/${encodeURIComponent(accessToken)}`;
}

export async function enqueueEventTicketWhatsAppNotification(
  tx: Prisma.TransactionClient,
  input: EventTicketWhatsAppNotificationInput,
) {
  const idempotencyKey = input.deliveryKey
    ? `event-ticket-whatsapp:${input.contaId}:${input.purchaseType}:${input.purchaseId}:${input.deliveryKey}`
    : `event-ticket-whatsapp:${input.contaId}:${input.purchaseType}:${input.purchaseId}:initial`;

  const notification = await tx.eventTicketWhatsAppNotification.createMany({
    data: {
      contaId: input.contaId,
      purchaseType: input.purchaseType,
      ...(input.purchaseType === EventTicketWhatsAppPurchaseType.PUBLIC_ORDER
        ? { eventMapOrderId: input.purchaseId }
        : { eventTicketSaleId: input.purchaseId }),
      templateName: input.templateName?.trim() || process.env.WHATSAPP_EVENT_TICKET_TEMPLATE_NAME?.trim() || 'ingresso_emitido',
      languageCode: input.languageCode?.trim() || process.env.WHATSAPP_EVENT_TICKET_TEMPLATE_LANGUAGE?.trim() || 'pt_BR',
      recipientPhone: input.recipientPhone,
      consentVersion: input.consentVersion ?? null,
      consentSource: input.consentSource ?? null,
      consentRecordedAt: input.consentRecordedAt ?? null,
      correlationId: `event-ticket:${input.purchaseType.toLowerCase()}:${input.purchaseId}`,
      idempotencyKey,
    },
    skipDuplicates: true,
  });

  if (notification.count === 1 && input.actorUserId) {
    await tx.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorUserId,
        action: 'events.ticket.whatsapp.queued',
        entityType: input.purchaseType === EventTicketWhatsAppPurchaseType.PUBLIC_ORDER ? 'EventMapOrder' : 'EventTicketSale',
        entityId: input.purchaseId,
        correlationId: `event-ticket:${input.purchaseType.toLowerCase()}:${input.purchaseId}`,
        metadata: {
          recipientSuffix: input.recipientPhone.slice(-4),
          idempotencyKey,
          consentSource: input.consentSource ?? null,
        } as Prisma.InputJsonObject,
      },
    });
  }

  return { queued: notification.count === 1, idempotencyKey };
}

export const EVENT_TICKET_WHATSAPP_CONSENT_VERSION = 'event-ticket-whatsapp-v1';
