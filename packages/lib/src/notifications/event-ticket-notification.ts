import { NotificationCategory, NotificationSeverity, NotificationType } from '@prisma/client';
import { prisma } from '../prisma';
import { isEventMapOrderRefundFinalized, isTicketPaymentBlocked } from '../events/ticket-payment-eligibility';
import { formatCurrency } from './notification-content';
import { createNotification } from './notification-write';
import type { PublicEventTicketInboxDispatchResult } from './notification-types';


export async function createPublicEventTicketInboxNotification(params: {
  contaId: string;
  orderId: string;
  asaasPaymentId: string;
  sourceType?: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC' | 'EVENT_ORDER';
}): Promise<PublicEventTicketInboxDispatchResult> {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: params.orderId, contaId: params.contaId },
    select: {
      id: true,
      contaId: true,
      eventId: true,
      buyerName: true,
      totalAmount: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      ticketFulfillmentStatus: true,
      items: { select: { id: true, ticket: { select: { id: true } } } },
      event: { select: { name: true } },
    },
  });
  if (!order) return 'retry';

  if (
    order.status === 'CANCELLED'
    || order.status === 'EXPIRED'
    || isEventMapOrderRefundFinalized(order.status, order.paymentStatus)
    || isTicketPaymentBlocked(order.paymentStatus)
  ) {
    return 'skipped';
  }
  const hasIssuedTickets = order.status === 'CONFIRMED'
    && order.ticketFulfillmentStatus === 'ISSUED'
    && order.items.length > 0
    && order.items.every((item) => Boolean(item.ticket));
  if (!hasIssuedTickets) return 'retry';

  const eventName = order.event.name || 'evento';
  const buyerName = order.buyerName.trim() || 'O comprador';
  const quantity = order.items.length;
  const amount = formatCurrency(Number(order.totalAmount)) ?? 'o valor do pedido';
  const paymentMethod = order.paymentMethod?.trim().toUpperCase();
  const paymentMethodPhrase = paymentMethod === 'PIX'
    ? 'via Pix'
    : paymentMethod === 'BOLETO'
      ? 'via boleto'
      : ['CREDIT_CARD', 'CREDITCARD', 'CARD', 'CARTAO_CREDITO'].includes(paymentMethod ?? '')
        ? 'no cartão de crédito'
        : 'pela forma de pagamento escolhida';
  const result = await createNotification({
    contaId: params.contaId,
    type: NotificationType.PAYMENT_CONFIRMED,
    category: NotificationCategory.PAYMENT,
    severity: NotificationSeverity.SUCCESS,
    title: 'Venda de ingressos confirmada',
    message: `${buyerName} comprou ${quantity} ${quantity === 1 ? 'ingresso' : 'ingressos'} para ${eventName}. O pagamento de ${amount} foi recebido ${paymentMethodPhrase}, e os ingressos foram emitidos.`,
    dedupeKey: `public-event-ticket-order:confirmed:${order.id}`,
    relatedPath: `/events/${order.eventId}`,
    entityType: 'EventMapOrder',
    entityId: order.id,
    sourceType: params.sourceType ?? 'EVENT_ORDER',
    sourceId: params.asaasPaymentId,
    metadata: {
      asaasPaymentId: params.asaasPaymentId,
      eventName,
      quantity,
      totalAmount: Number(order.totalAmount),
      paymentMethod: order.paymentMethod,
    },
    actor: { type: 'SYSTEM' },
  });
  return result.notificationId ? 'created' : 'skipped';
}
