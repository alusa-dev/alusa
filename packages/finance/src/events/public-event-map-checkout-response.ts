import { Prisma } from '@prisma/client';
import { publicOrderStatusPath, publicOrderTicketsPath } from '@alusa/lib/events/map/public-order-links';
import { toMoney } from '@alusa/lib/events/map/event-map-order-operations';

type PublicCheckoutOrderRecord = Prisma.EventMapOrderGetPayload<{
  include: { items: { include: { ticket: true } } };
}>;

function hasCompleteTickets(order: PublicCheckoutOrderRecord) {
  return order.items.length > 0 && order.items.every((item) => Boolean(item.ticket));
}

/** Builds the buyer-facing checkout DTO from the persisted order and payment details. */
export function buildPublicEventMapCheckoutResponse(
  order: PublicCheckoutOrderRecord,
  params?: {
    publicSlug?: string | null;
    pixQrCode?: { encodedImage: string; payload: string; expirationDate: string } | null;
    bankSlipCode?: string | null;
    bankSlipBarcode?: string | null;
  },
) {
  return {
    orderId: order.id,
    accessToken: order.accessToken,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    expiresAt: order.expiresAt?.toISOString() ?? order.createdAt.toISOString(),
    asaasPaymentId: order.asaasPaymentId,
    invoiceUrl: order.invoiceUrl,
    ticketsUrl:
      order.status === 'CONFIRMED'
      && order.ticketFulfillmentStatus === 'ISSUED'
      && hasCompleteTickets(order)
        ? publicOrderTicketsPath(order.id, order.accessToken)
        : null,
    ticketFulfillmentStatus: order.ticketFulfillmentStatus,
    statusUrl: publicOrderStatusPath(params?.publicSlug, order.id, order.accessToken),
    items: order.items.map((item) => ({
      ticketCode: item.ticket?.ticketCode ?? '',
      seatLabel: item.seatLabel,
      sectionName: item.sectionName,
    })),
    pixQrCode: params?.pixQrCode ?? null,
    bankSlipCode: params?.bankSlipCode ?? null,
    bankSlipBarcode: params?.bankSlipBarcode ?? null,
  };
}
