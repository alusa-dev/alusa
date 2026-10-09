import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { EventsError } from '../events.service';
import { isTicketPaymentBlocked } from '../ticket-checkin.service';
import { isPublicOrderRefundActionPending } from './public-order-refund-action';
import { publicOrderStatusPath, publicOrderTicketsPath } from './public-order-links';
import { toMoney } from './event-map-order-operations';

type EventTicketRecord = Prisma.EventTicketGetPayload<Prisma.EventTicketDefaultArgs>;
function hasCompletePublicOrderTickets(order: { items: Array<{ ticket: EventTicketRecord | null }> }) {
  return order.items.length > 0 && order.items.every((item) => Boolean(item.ticket));
}

export async function getPublicEventMapOrderStatus(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken },
    include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true } },
      map: { select: { id: true, name: true, publicSlug: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true } },
      reservation: {
        include: {
          seats: {
            include: {
              publicSeat: true,
            },
          },
        },
      },
      items: {
        include: {
          publicSeat: true,
          ticket: true,
        },
        orderBy: [{ sectionName: 'asc' }, { seatLabel: 'asc' }],
      },
    },
  });

  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);

  const reservedSeats = order.reservation?.seats.map((seat) => seat.publicSeat) ?? [];
  const confirmedItems = order.items;
  const ticketsAvailable =
    order.status === 'CONFIRMED'
    && order.ticketFulfillmentStatus === 'ISSUED'
    && !isTicketPaymentBlocked(order.paymentStatus)
    && hasCompletePublicOrderTickets(order);
  const ticketsUrl = ticketsAvailable ? publicOrderTicketsPath(order.id, order.accessToken) : null;
  let refundRequestUrl: string | null = null;
  const latePaymentBuyerRefundActionPending =
    order.paymentMethod === 'BOLETO' &&
    order.status === 'CONFIRMED' &&
    order.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:') &&
    ['RECEIVED', 'CONFIRMED'].includes(order.paymentStatus?.trim().toUpperCase() ?? '');
  if (isPublicOrderRefundActionPending(order) && order.refundRequestUrl) {
    try {
      const url = new URL(order.refundRequestUrl);
      if (url.protocol === 'https:' && (url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com'))) {
        refundRequestUrl = url.toString();
      }
    } catch {
      // Never expose malformed persisted provider links.
    }
  }
  if (
    latePaymentBuyerRefundActionPending
  ) {
    const refundEffect = await prisma.financeWebhookSideEffectOutbox.findFirst({
      where: {
        contaId: order.contaId,
        dedupeKey: `${order.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`,
      },
      select: { payload: true },
    });
    const candidatePayload = refundEffect?.payload as {
      bankSlipRefundRequestUrl?: unknown;
      requestState?: unknown;
    } | null;
    const candidate = isPublicOrderRefundActionPending({
      ...order,
      requestState: candidatePayload?.requestState,
    })
      ? candidatePayload?.bankSlipRefundRequestUrl
      : null;
    if (!refundRequestUrl && typeof candidate === 'string') {
      try {
        const url = new URL(candidate);
        if (url.protocol === 'https:' && (url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com'))) {
          refundRequestUrl = url.toString();
        }
      } catch {
        // Ignore malformed persisted provider links; never expose an unsafe URL.
      }
    }
  }

  return {
    orderId: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    ticketFulfillmentStatus: order.ticketFulfillmentStatus,
    paymentMethod: order.paymentMethod,
    ticketFulfillmentLastError: order.ticketFulfillmentLastError,
    paymentStatus: order.paymentStatus,
    refundRequestUrl,
    invoiceUrl: order.invoiceUrl,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    ticketsUrl,
    statusUrl: publicOrderStatusPath(order.map.publicSlug, order.id, order.accessToken),
    event: {
      ...order.event,
      startsAt: (order.map.startsAt ?? order.event.startsAt).toISOString(),
      endsAt: order.map.endsAt?.toISOString() ?? null,
      locationName: order.map.locationName ?? order.event.locationName,
      locationAddress: order.map.locationAddress ?? order.event.locationAddress,
    },
    map: order.map,
    items: (confirmedItems.length > 0 ? confirmedItems : reservedSeats).map((item) => {
      if ('publicSeat' in item && 'seatLabel' in item) {
        return {
          ticketCode: item.ticket?.ticketCode ?? null,
          ticketStatus: item.ticket?.status ?? null,
          seatLabel: item.seatLabel,
          sectionName: item.sectionName,
          technicalCode: item.technicalCode,
          unitPrice: toMoney(item.unitPriceSnapshot),
        };
      }

      return {
        ticketCode: null,
        ticketStatus: null,
        seatLabel: item.displayLabel,
        sectionName: item.sectionName,
        technicalCode: item.technicalCode,
        unitPrice: toMoney(item.unitPrice),
      };
    }),
  };
}


export type PublicOrderStatusDTO = Awaited<ReturnType<typeof getPublicEventMapOrderStatus>>;
