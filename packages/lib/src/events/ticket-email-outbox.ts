import { FinanceWebhookSideEffectStatus, Prisma } from '@prisma/client';

type EventTicketEmailOutboxParams = {
  contaId: string;
  purchaseId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  eventStartsAt: Date;
  eventLocation?: string | null;
  ticketType?: string | null;
  ticketCount: number;
  ticketsPath: string;
  ticketsHtmlPath?: string | null;
  statusPath?: string | null;
  deliveryKey?: string;
};

export function buildPublicEventTicketSalePath(saleId: string, accessToken: string) {
  return `/api/public/event-ticket-sales/${saleId}/tickets?token=${encodeURIComponent(accessToken)}`;
}

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function enqueueEventTicketEmail(
  tx: Prisma.TransactionClient,
  params: EventTicketEmailOutboxParams,
) {
  const deliveryKey = params.deliveryKey ?? 'initial';
  const dedupeKey = deliveryKey === 'initial'
    ? `${params.contaId}:EVENT_PUBLIC_ORDER_TICKET_EMAIL:${params.purchaseId}`
    : `${params.contaId}:EVENT_PUBLIC_ORDER_TICKET_EMAIL:${params.purchaseId}:${deliveryKey}`;

  await tx.financeWebhookSideEffectOutbox.createMany({
    data: {
      contaId: params.contaId,
      effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL',
      dedupeKey,
      payload: toAuditJson({
        orderId: params.purchaseId,
        buyerEmail: params.buyerEmail,
        buyerName: params.buyerName,
        eventName: params.eventName,
        eventStartsAt: params.eventStartsAt.toISOString(),
        eventLocation: params.eventLocation ?? null,
        ticketType: params.ticketType ?? null,
        ticketCount: params.ticketCount,
        ticketsPath: params.ticketsPath,
        ticketsHtmlPath: params.ticketsHtmlPath ?? null,
        statusPath: params.statusPath ?? null,
        deliveryKey,
      }),
      status: FinanceWebhookSideEffectStatus.PENDING,
    },
    skipDuplicates: true,
  });
}
