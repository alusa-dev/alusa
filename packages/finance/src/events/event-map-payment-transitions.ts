import { prisma } from '@alusa/database';
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

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

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

  const updated = await prisma.eventMapOrder.updateMany({
    where: {
      id: target.id,
      contaId: params.contaId,
      status: { in: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED'] },
      OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
      AND: [{ OR: [{ paymentStatus: null }, { paymentStatus: { not: 'CHARGEBACK_UNKNOWN' } }] }],
    },
    data: {
      asaasPaymentId: params.asaasPaymentId,
      paymentStatus: params.paymentStatus ?? 'PENDING',
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

  const paidAt = params.paidAt ? new Date(params.paidAt) : new Date();
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
        map: { select: { publishedVersionId: true } },
        reservation: { include: { seats: { include: { publicSeat: { select: { status: true } } } } } },
      },
    });
    if (!order) return null;
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
      where: { id: order.id, contaId: params.contaId, status: order.status },
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

    const refundedAmount = params.refundedAmount ?? toMoney(order.totalAmount);
    const status = params.partial && refundedAmount < toMoney(order.totalAmount) ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
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
    const sales = await tx.eventTicketSale.findMany({
      where: { contaId: order.contaId, eventMapOrderId: order.id },
    });
    let remainingRefund = refundedAmount;
    for (const sale of sales) {
      const saleTotal = toMoney(sale.totalAmount);
      const saleRefund = status === 'REFUNDED' ? saleTotal : Math.min(saleTotal, Math.max(remainingRefund, 0));
      remainingRefund = Math.max(remainingRefund - saleRefund, 0);
      await tx.eventTicketSale.update({
        where: { id: sale.id },
        data: {
          status: status === 'REFUNDED' ? 'REFUNDED' : sale.status,
          refundedAt: now,
          refundedAmount: decimal(saleRefund),
          paymentStatus: status,
        },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: order.contaId, originType: 'TICKET_SALE', originId: sale.id },
        data: {
          status: status === 'REFUNDED' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          refundedAt: now,
          refundedAmount: decimal(saleRefund),
          netAmount: decimal(Math.max(toMoney(sale.totalAmount) - saleRefund, 0)),
          paymentStatus: status,
        },
      });
      await syncPublicLotQuantity(tx, order.contaId, sale.lotId);
    }
    const updated = await tx.eventMapOrder.updateMany({
      where: { id: order.id, contaId: params.contaId },
      data: { status, refundedAt: now, refundedAmount: decimal(refundedAmount), paymentStatus: status },
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
