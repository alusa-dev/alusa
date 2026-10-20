import { prisma } from '@alusa/database';
import { parsePaymentDate } from '@alusa/shared';
import {
  cancelPublicEventMapOrder,
  decimal,
  findEventMapOrderForPayment,
  lockPublicEventMapReservation,
  normalizeTicketFulfillmentError,
  parseEventMapOrderExternalReference,
  syncPublicLotQuantity,
  toAuditJson,
  toMoney,
} from '@alusa/lib/events/map/event-map-order-operations';
import {
  isEventMapOrderRefundFinalized,
  isTicketPaymentBlocked,
  mayResolveChargebackPaymentHold,
} from '@alusa/domain/events';
import { logEventsFinance } from './events-finance-observability';

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);
const SETTLED_OR_BLOCKED_ASAAS_PAYMENT_STATUSES = [
  ...PAID_ASAAS_PAYMENT_STATUSES,
  'CANCELLATION_IN_PROGRESS',
  'REFUNDED', 'PAYMENT_REFUNDED', 'PARTIALLY_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED', 'REFUND_DENIED', 'REVERSED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'IN_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL', 'DISPUTE_LOST', 'CHARGEBACK', 'CHARGEBACK_DEPOSITED',
  'CHARGEBACK_LOST', 'CHARGEBACK_WON', 'REQUESTED', 'DONE', 'CHARGEBACK_UNKNOWN',
];

export type EventMapPaymentReference = {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
};

export async function syncPublicEventMapOrderPaymentCreated(params: EventMapPaymentReference & {
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
}) {
  const orderId = parseEventMapOrderExternalReference(params.externalReference);
  if (!orderId) return null;
  const target = await findEventMapOrderForPayment(prisma, params);
  if (!target || target.id !== orderId) return null;

  const incomingPaymentStatus = (params.paymentStatus ?? 'PENDING').trim().toUpperCase();
  const isDeletion = incomingPaymentStatus === 'DELETED';

  const updated = await prisma.eventMapOrder.updateMany({
    where: {
      id: target.id,
      contaId: params.contaId,
      // A deletion webhook follows the domain cancellation and must still
      // persist on CANCELLED orders. A stale nonterminal snapshot must not
      // update an order that became cancelled after its handler pre-read.
      status: { in: isDeletion ? ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED'] : ['PAYMENT_PENDING', 'EXPIRED'] },
      OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
      AND: [
        { OR: [{ paymentStatus: null }, { paymentStatus: { notIn: SETTLED_OR_BLOCKED_ASAAS_PAYMENT_STATUSES } }] },
        ...(isDeletion ? [] : [{ OR: [{ paymentStatus: null }, { paymentStatus: { not: 'DELETED' } }] }]),
      ],
    },
    data: {
      asaasPaymentId: params.asaasPaymentId,
      paymentStatus: incomingPaymentStatus,
      invoiceUrl: params.invoiceUrl ?? undefined,
      paymentProvider: 'ASAAS',
    },
  });
  return updated.count > 0 ? { orderId, status: 'PAYMENT_PENDING' as const } : null;
}

export async function reconcileEventMapOrderFinancialStateFromAsaas(params: EventMapPaymentReference & {
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
  paidAt?: Date | string | null;
  paidAmount?: number | null;
  ticketFulfillmentError?: string | null;
  chargebackStatus?: string | null;
}): Promise<{ orderId: string; status: string; financialOnly: true; blocked?: true } | null> {
  const paymentStatus = (params.paymentStatus ?? '').trim().toUpperCase();
  if (!PAID_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) return null;

  const paidAt = params.paidAt
    ? typeof params.paidAt === 'string'
      ? parsePaymentDate(params.paidAt)
      : params.paidAt
    : new Date();
  if (Number.isNaN(paidAt.getTime())) return null;

  return prisma.$transaction(async (tx) => {
    const candidate = await findEventMapOrderForPayment(tx, params);
    if (!candidate) return null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EventMapOrder"
      WHERE id = ${candidate.id} AND "contaId" = ${params.contaId}
      FOR UPDATE
    `;
    if (locked.length !== 1) return null;
    const order = await tx.eventMapOrder.findFirst({
      where: {
        id: candidate.id,
        contaId: params.contaId,
        OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
        status: { in: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED', 'CONFIRMED'] },
      },
      include: {
        map: { select: { contaId: true, eventId: true, publishedVersionId: true } },
        version: { select: { contaId: true, eventMapId: true } },
        event: { select: { id: true, contaId: true } },
        reservation: {
          include: {
            seats: {
              include: {
                publicSeat: { select: { contaId: true, eventId: true, eventMapId: true, versionId: true, status: true } },
              },
            },
          },
        },
        items: { include: { publicSeat: { select: { contaId: true, eventId: true, eventMapId: true, versionId: true } }, ticket: true } },
      },
    });
    if (!order) return null;
    if (order.map.contaId !== order.contaId || order.map.eventId !== order.eventId
      || order.event.contaId !== order.contaId || order.event.id !== order.eventId
      || order.version.contaId !== order.contaId || order.version.eventMapId !== order.eventMapId
      || order.items.some((item) => item.contaId !== order.contaId || item.orderId !== order.id
        || !order.reservation?.seats.some((entry) => entry.publicSeatId === item.publicSeatId)
        || item.publicSeat.contaId !== order.contaId || item.publicSeat.eventId !== order.eventId
        || item.publicSeat.eventMapId !== order.eventMapId || item.publicSeat.versionId !== order.versionId
        || (item.ticket !== null && (item.ticket.contaId !== order.contaId || item.ticket.eventId !== order.eventId
          || item.ticket.eventMapOrderId !== order.id || item.ticket.orderItemId !== item.id)))
      || (order.reservation !== null && (order.reservation.contaId !== order.contaId
        || order.reservation.eventId !== order.eventId || order.reservation.eventMapId !== order.eventMapId
        || order.reservation.versionId !== order.versionId || order.reservation.id !== order.reservationId
        || order.reservation.seats.some((entry) => entry.contaId !== order.contaId
          || entry.reservationId !== order.reservation!.id || entry.publicSeat.contaId !== order.contaId
          || entry.publicSeat.eventId !== order.eventId || entry.publicSeat.eventMapId !== order.eventMapId
          || entry.publicSeat.versionId !== order.versionId)))) return null;
    // A paid snapshot obtained before a cancellation/deletion can race with
    // the cancellation webhook. Keep the financial discrepancy visible, but
    // never promote a terminal cancellation state or enqueue effects from
    // that stale snapshot. This read is protected by the order row lock.
    const normalizedOrderPaymentStatus = order.paymentStatus?.trim().toUpperCase() ?? null;
    if (normalizedOrderPaymentStatus === 'DELETED' || normalizedOrderPaymentStatus === 'CANCELLATION_IN_PROGRESS') {
      return { orderId: order.id, status: order.status, financialOnly: true, blocked: true };
    }
    if (
      isTicketPaymentBlocked(order.paymentStatus)
      && !mayResolveChargebackPaymentHold(order.paymentStatus, params.chargebackStatus)
    ) return { orderId: order.id, status: order.status, financialOnly: true, blocked: true };
    const releasedOrder = order.status === 'EXPIRED' || order.status === 'CANCELLED';
    const stalePublishedVersion = order.versionId !== order.map.publishedVersionId;
    if (order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'REQUIRES_RECONCILIATION') {
      if (stalePublishedVersion) {
        const refundValue = typeof params.paidAmount === 'number' && Number.isFinite(params.paidAmount)
          ? toMoney(params.paidAmount)
          : toMoney(order.totalAmount);
        await tx.financeWebhookSideEffectOutbox.createMany({
          data: {
            contaId: params.contaId,
            effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
            dedupeKey: `${params.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`,
            payload: toAuditJson({
              orderId: order.id,
              asaasPaymentId: params.asaasPaymentId,
              value: refundValue,
              description: `Estorno por indisponibilidade dos assentos - pedido ${order.id}`,
              requestState: 'NOT_SUBMITTED',
            }),
            status: 'PENDING',
          },
          skipDuplicates: true,
        });
      }
      return { orderId: order.id, status: 'CONFIRMED', financialOnly: true };
    }

    const seatsStillFree = order.reservation?.seats.length
      && order.reservation.seats.every((seat) => seat.publicSeat.status === 'AVAILABLE');
    if (releasedOrder && seatsStillFree && !stalePublishedVersion) return null;
    const cannotFulfillLatePayment = stalePublishedVersion || (releasedOrder && !seatsStillFree);

    const update = await tx.eventMapOrder.updateMany({
      where: {
        id: order.id,
        contaId: params.contaId,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
      data: {
        status: 'CONFIRMED',
        ticketFulfillmentStatus: 'REQUIRES_RECONCILIATION',
        ticketFulfillmentAttempts: { increment: 1 },
        ticketFulfillmentLastAttemptAt: new Date(),
        ticketFulfillmentLastError: cannotFulfillLatePayment
          ? 'ASSENTOS_INDISPONIVEIS: pagamento confirmado após expiração/cancelamento; estorno automático solicitado.'
          : normalizeTicketFulfillmentError(params.ticketFulfillmentError),
        asaasPaymentId: params.asaasPaymentId,
        paymentStatus: params.chargebackStatus?.trim().toUpperCase() === 'REVERSED' ? 'REVERSED' : paymentStatus,
        paymentProvider: 'ASAAS',
        invoiceUrl: params.invoiceUrl ?? undefined,
        paidAt,
        confirmedAt: order.confirmedAt ?? paidAt,
      },
    });
    if (update.count !== 1) return null;

    if (cannotFulfillLatePayment) {
      const refundValue = typeof params.paidAmount === 'number' && Number.isFinite(params.paidAmount)
        ? toMoney(params.paidAmount)
        : toMoney(order.totalAmount);
      await tx.financeWebhookSideEffectOutbox.createMany({
        data: {
          contaId: params.contaId,
          effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
          dedupeKey: `${params.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`,
          payload: toAuditJson({
            orderId: order.id,
            asaasPaymentId: params.asaasPaymentId,
            value: refundValue,
            description: `Estorno por indisponibilidade dos assentos - pedido ${order.id}`,
            requestState: 'NOT_SUBMITTED',
          }),
          status: 'PENDING',
        },
        skipDuplicates: true,
      });
    }
    await tx.auditLog.create({
      data: {
        contaId: params.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: cannotFulfillLatePayment
          ? 'events.map.public.payment.late_refund_enqueued'
          : 'events.map.public.payment.reconcile_financial',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({
          eventId: order.eventId,
          asaasPaymentId: params.asaasPaymentId,
          paymentStatus: params.chargebackStatus?.trim().toUpperCase() === 'REVERSED' ? 'REVERSED' : paymentStatus,
          financialOnly: true,
          latePaymentRefundQueued: Boolean(cannotFulfillLatePayment),
        }),
      },
    });
    return { orderId: order.id, status: 'CONFIRMED', financialOnly: true };
  });
}

export async function cancelPublicEventMapOrderByPayment(params: EventMapPaymentReference & { reason?: string | null }) {
  const order = await findEventMapOrderForPayment(prisma, params);
  if (!order) return null;
  return cancelPublicEventMapOrder(
    params.contaId,
    order.id,
    params.reason ?? 'Pagamento cancelado/expirado.',
  );
}

/** Finalize the local state only after the provider payment is already deleted. */
export async function finalizeDeletedPublicEventMapOrder(params: { contaId: string; orderId: string }) {
  const order = await prisma.eventMapOrder.findFirst({
    where: {
      id: params.orderId,
      contaId: params.contaId,
      status: 'PAYMENT_PENDING',
      paymentStatus: 'DELETED',
      asaasPaymentId: { not: null },
    },
    select: { id: true },
  });
  if (!order) return null;
  const result = await cancelPublicEventMapOrder(
    params.contaId,
    order.id,
    'ASAAS_PAYMENT_ALREADY_DELETED',
    { expectedPaymentStatus: 'DELETED' },
  );
  return result.ok ? result : null;
}

export async function refundPublicEventMapOrderByPayment(params: EventMapPaymentReference & {
  refundedAmount?: number | null;
  partial?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await findEventMapOrderForPayment(tx, params);
    if (!candidate) return null;
    if (candidate.reservationId) {
      await lockPublicEventMapReservation(tx, { contaId: params.contaId, reservationId: candidate.reservationId });
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EventMapOrder"
      WHERE id = ${candidate.id} AND "contaId" = ${params.contaId}
      FOR UPDATE
    `;
    if (locked.length !== 1) return null;
    const order = await tx.eventMapOrder.findFirst({
      where: {
        id: candidate.id,
        contaId: params.contaId,
        OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
      },
      include: { items: { include: { ticket: true } } },
    });
    if (!order) return null;
    if (order.status === 'REFUNDED') return { orderId: order.id, status: order.status };

    const persistedOrderRefund = Math.max(toMoney(order.refundedAmount), 0);
    const sales = await tx.eventTicketSale.findMany({
      where: { contaId: order.contaId, eventMapOrderId: order.id },
      orderBy: { id: 'asc' },
    });
    const orderTotal = toMoney(order.totalAmount);
    const overRefundedSaleCount = sales.filter(
      (sale) => toMoney(sale.refundedAmount) > toMoney(sale.totalAmount),
    ).length;
    const overRefundedOrderCount = persistedOrderRefund > orderTotal ? 1 : 0;
    const overRefundedCount = overRefundedSaleCount + overRefundedOrderCount;
    if (overRefundedCount > 0) {
      logEventsFinance(
        'finance.events.ticket_sale.refund_amount_over_gross',
        { errors: overRefundedCount },
        'warn',
      );
    }
    const persistedSaleRefunds = sales.reduce(
      (total, sale) => toMoney(total + toMoney(sale.refundedAmount)),
      0,
    );
    const providerRefundTotal = Math.min(orderTotal, Math.max(
      params.refundedAmount == null ? orderTotal : toMoney(params.refundedAmount),
      0,
    ));
    const cumulativeRefund = Math.min(orderTotal, Math.max(
      providerRefundTotal,
      persistedOrderRefund,
      persistedSaleRefunds,
    ));
    const status = params.partial && providerRefundTotal < orderTotal ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    const paymentHeld = status !== 'REFUNDED' && isTicketPaymentBlocked(order.paymentStatus);
    const projectedOrderStatus = paymentHeld ? order.status : status;
    const projectedPaymentStatus = paymentHeld ? order.paymentStatus : status;
    const now = new Date();
    if (status === 'REFUNDED') {
      await tx.eventTicket.updateMany({
        where: { contaId: order.contaId, eventMapOrderId: order.id, status: 'VALID' },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      const refundableSeatIds = order.items
        .filter((item) => item.ticket?.status !== 'USED')
        .map((item) => item.publicSeatId);
      await tx.eventMapPublicSeat.updateMany({
        where: { contaId: order.contaId, id: { in: refundableSeatIds }, status: 'SOLD' },
        data: { status: 'AVAILABLE' },
      });
    }
    let remainingIncrement = toMoney(Math.max(cumulativeRefund - persistedSaleRefunds, 0));
    for (const sale of sales) {
      const saleTotal = toMoney(sale.totalAmount);
      const persistedRefund = Math.max(0, toMoney(sale.refundedAmount));
      const saleCapacity = Math.max(saleTotal - persistedRefund, 0);
      const saleRefund = status === 'REFUNDED'
        ? Math.max(saleTotal, persistedRefund)
        : toMoney(persistedRefund + Math.min(saleCapacity, remainingIncrement));
      remainingIncrement = toMoney(Math.max(remainingIncrement - (saleRefund - persistedRefund), 0));
      const saleFullyRefunded = status === 'REFUNDED' || (saleTotal > 0 && saleRefund >= saleTotal);
      const saleHasRefund = saleRefund > 0;
      const projectedSalePaymentStatus = status === 'REFUNDED'
        ? status
        : saleHasRefund
          ? paymentHeld
            ? order.paymentStatus
            : isTicketPaymentBlocked(sale.paymentStatus)
              ? sale.paymentStatus
              : status
          : sale.paymentStatus;
      await tx.eventTicketSale.update({
        where: { id: sale.id, contaId: order.contaId, eventMapOrderId: order.id },
        data: {
          status: saleFullyRefunded ? 'REFUNDED' : sale.status,
          ...(saleHasRefund || status === 'REFUNDED' ? { refundedAt: now } : {}),
          refundedAmount: decimal(saleRefund),
          paymentStatus: projectedSalePaymentStatus,
        },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: order.contaId, originType: 'TICKET_SALE', originId: sale.id },
        data: {
          ...(saleFullyRefunded
            ? { status: 'REFUNDED' as const }
            : saleHasRefund
              ? { status: 'PARTIALLY_REFUNDED' as const }
              : {}),
          ...(saleHasRefund || status === 'REFUNDED' ? { refundedAt: now } : {}),
          refundedAmount: decimal(saleRefund),
          netAmount: decimal(Math.max(toMoney(sale.totalAmount) - saleRefund, 0)),
          paymentStatus: projectedSalePaymentStatus,
        },
      });
      await syncPublicLotQuantity(tx, order.contaId, sale.lotId);
    }
    const updated = await tx.eventMapOrder.updateMany({
      where: { id: order.id, contaId: params.contaId },
      data: {
        status: projectedOrderStatus,
        refundedAt: now,
        refundedAmount: decimal(Math.max(
          status === 'REFUNDED' ? orderTotal : cumulativeRefund,
          persistedOrderRefund,
        )),
        paymentStatus: projectedPaymentStatus,
      },
    });
    if (updated.count !== 1) return null;
    return { orderId: order.id, status };
  });
}

export async function markPublicEventMapOrderRefundProcessingByPayment(params: EventMapPaymentReference & {
  paymentStatus: string;
  rawChargebackStatus?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await findEventMapOrderForPayment(tx, params);
    if (!candidate) return null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EventMapOrder"
      WHERE "contaId" = ${params.contaId} AND id = ${candidate.id}
      FOR UPDATE
    `;
    if (locked.length === 0) return null;
    const order = await tx.eventMapOrder.findFirst({
      where: {
        id: candidate.id,
        contaId: params.contaId,
        OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
      },
    });
    if (!order) return null;
    if (isEventMapOrderRefundFinalized(order.status, order.paymentStatus)) {
      return { orderId: order.id, status: order.status, paymentStatus: order.paymentStatus };
    }
    if (
      params.paymentStatus === 'REVERSED'
      && isTicketPaymentBlocked(order.paymentStatus)
      && !mayResolveChargebackPaymentHold(order.paymentStatus, 'REVERSED')
    ) return { orderId: order.id, status: order.status, paymentStatus: order.paymentStatus };

    const updated = await tx.eventMapOrder.updateMany({
      where: { id: order.id, contaId: params.contaId },
      data: {
        paymentStatus: params.paymentStatus,
        ...(params.paymentStatus === 'REFUND_REQUESTED' ? { refundRequestUrl: null } : {}),
      },
    });
    if (updated.count !== 1) return null;

    if (params.rawChargebackStatus) {
      await tx.auditLog.create({
        data: {
          contaId: order.contaId,
          actorType: 'SYSTEM',
          actorId: null,
          action: 'events.map.public.chargeback.unknown_status',
          entityType: 'EventMapOrder',
          entityId: order.id,
          metadata: toAuditJson({
            eventId: order.eventId,
            asaasPaymentId: params.asaasPaymentId,
            rawChargebackStatus: params.rawChargebackStatus,
            paymentStatusSentinel: 'CHARGEBACK_UNKNOWN',
          }),
        },
      });
    }
    const sales = await tx.eventTicketSale.findMany({
      where: { contaId: order.contaId, eventMapOrderId: order.id },
      select: { id: true },
    });
    const saleIds = sales.map((sale) => sale.id);
    await tx.eventTicketSale.updateMany({
      where: { contaId: order.contaId, eventMapOrderId: order.id },
      data: { paymentStatus: params.paymentStatus },
    });
    if (saleIds.length > 0) {
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: order.contaId, originType: 'TICKET_SALE', originId: { in: saleIds } },
        data: { paymentStatus: params.paymentStatus },
      });
    }
    return { orderId: order.id, status: order.status, paymentStatus: params.paymentStatus };
  });
}
