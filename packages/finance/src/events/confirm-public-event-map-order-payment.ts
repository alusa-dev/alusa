import { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';
import { EventsError } from '@alusa/domain/events';
import { enqueueEventTicketEmail } from '@alusa/lib/events/ticket-email-outbox';
import { createCheckInCode } from '@alusa/lib/events/map/ticket-code';
import {
  decimal,
  findEventMapOrderForPayment,
  lockPublicEventMapReservation,
  syncPublicLotQuantity,
  toAuditJson,
  toMoney,
} from '@alusa/lib/events/map/event-map-order-operations';
import { isTicketPaymentBlocked, mayResolveChargebackPaymentHold } from '@alusa/domain/events';
import { publicOrderStatusPath, publicOrderTicketsPath } from '@alusa/lib/events/map/public-order-links';

type EventMapPublicSeatRecord = Prisma.EventMapPublicSeatGetPayload<Prisma.EventMapPublicSeatDefaultArgs>;
type EventMapOrderItemRecord = Prisma.EventMapOrderItemGetPayload<Prisma.EventMapOrderItemDefaultArgs>;
type EventTicketRecord = Prisma.EventTicketGetPayload<Prisma.EventTicketDefaultArgs>;

function hasCompletePublicOrderTickets(order: { items: Array<{ ticket: EventTicketRecord | null }> }) {
  return order.items.length > 0 && order.items.every((item) => Boolean(item.ticket));
}

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

export async function confirmPublicEventMapOrderPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
  paidAt?: Date | string | null;
  paidAmount?: number | null;
  allowReleasedReservation?: boolean;
  chargebackStatus?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await findEventMapOrderForPayment(tx, params);
    if (!candidate) return null;
    if (candidate.reservationId) {
      await lockPublicEventMapReservation(tx, {
        contaId: params.contaId,
        reservationId: candidate.reservationId,
      });
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
      include: {
        map: true,
        event: { select: { name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true } },
        reservation: { include: { seats: { include: { publicSeat: true } } } },
        items: { include: { ticket: true, publicSeat: true } },
      },
    });
    if (!order) return null;

    if (
      isTicketPaymentBlocked(order.paymentStatus)
      && !mayResolveChargebackPaymentHold(order.paymentStatus, params.chargebackStatus)
    ) {
      throw new EventsError(
        'PAGAMENTO_BLOQUEADO_POR_ANALISE',
        'O pedido está bloqueado por análise financeira e não pode emitir ingressos.',
        409,
      );
    }

    if (order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'ISSUED' && hasCompletePublicOrderTickets(order)) {
      return {
        orderId: order.id,
        status: order.status,
        ticketsCreated: order.items.filter((item) => item.ticket).length,
      };
    }

    if (order.versionId !== order.map.publishedVersionId) {
      throw new EventsError(
        'MAPA_VERSAO_ALTERADA',
        'A versão do mapa deste pedido foi substituída. A emissão será interrompida e o pagamento seguirá para reconciliação financeira.',
        409,
      );
    }

    if (
      order.status !== 'PAYMENT_PENDING' &&
      order.status !== 'CONFIRMED' &&
      !(params.allowReleasedReservation && (order.status === 'EXPIRED' || order.status === 'CANCELLED'))
    ) {
      throw new EventsError('PEDIDO_NAO_CONFIRMAVEL', 'Pedido público não está pendente de pagamento.', 409);
    }

    const expectedAmount = toMoney(order.totalAmount);
    const receivedAmount = typeof params.paidAmount === 'number' && Number.isFinite(params.paidAmount)
      ? toMoney(params.paidAmount)
      : null;
    if (receivedAmount === null || Math.abs(receivedAmount - expectedAmount) > 0.01) {
      throw new EventsError(
        'VALOR_PAGAMENTO_DIVERGENTE',
        'O valor confirmado pelo provedor não corresponde ao valor do pedido. O pedido ficará disponível para reconciliação.',
        409,
      );
    }

    let reservation = order.reservation;
    if (!reservation) {
      throw new EventsError('RESERVA_INVALIDA', 'Reserva do pedido público não está disponível para confirmação.', 409);
    }
    if (
      (reservation.status === 'EXPIRED' || reservation.status === 'CANCELLED')
      && params.allowReleasedReservation
    ) {
      const releasedSeatIds = reservation.seats.map((entry) => entry.publicSeatId);
      if (reservation.seats.some((entry) => entry.publicSeat.status === 'SOLD')) {
        throw new EventsError('ASSENTOS_REVENDIDOS', 'Um ou mais assentos desta reserva já foram vendidos novamente.', 409);
      }
      if (releasedSeatIds.length === 0 || reservation.seats.some((entry) => entry.publicSeat.status !== 'AVAILABLE')) {
        throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos desta reserva não estão mais disponíveis.', 409);
      }

      const reclaimedSeats = await tx.eventMapPublicSeat.updateMany({
        where: { contaId: order.contaId, id: { in: releasedSeatIds }, status: 'AVAILABLE' },
        data: { status: 'HELD' },
      });
      if (reclaimedSeats.count !== releasedSeatIds.length) {
        throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos foram reservados por outra compra.', 409);
      }

      const reclaimedReservation = await tx.eventMapReservation.updateMany({
        where: { id: reservation.id, contaId: order.contaId, status: { in: ['EXPIRED', 'CANCELLED'] } },
        data: { status: 'HELD', cancelledAt: null, consumedAt: null },
      });
      if (reclaimedReservation.count !== 1) {
        throw new EventsError('RESERVA_INVALIDA', 'A reserva já foi processada por outra operação.', 409);
      }
      reservation = {
        ...reservation,
        status: 'HELD',
        seats: reservation.seats.map((entry) => ({
          ...entry,
          publicSeat: { ...entry.publicSeat, status: 'HELD' },
        })),
      };
    }
    if (reservation.status !== 'HELD') {
      throw new EventsError('RESERVA_INVALIDA', 'Reserva do pedido público não está disponível para confirmação.', 409);
    }
    if (!params.allowReleasedReservation && reservation.expiresAt < new Date()) {
      throw new EventsError('RESERVA_EXPIRADA', 'Reserva do pedido público expirou antes da confirmação do pagamento.', 409);
    }

    const publicSeats = reservation.seats.map((entry) => entry.publicSeat);
    if (publicSeats.length === 0 || publicSeats.some((seat) => seat.status !== 'HELD')) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Assentos do pedido público não estão mais reservados.', 409);
    }

    const soldUpdate = await tx.eventMapPublicSeat.updateMany({
      where: { contaId: order.contaId, id: { in: publicSeats.map((seat) => seat.id) }, status: 'HELD' },
      data: { status: 'SOLD' },
    });
    if (soldUpdate.count !== publicSeats.length) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos não puderam ser vendidos.', 409);
    }

    const createdItems: Array<{ item: EventMapOrderItemRecord; ticket: EventTicketRecord; seat: EventMapPublicSeatRecord }> = [];
    for (const seat of publicSeats) {
      const existingItem = order.items.find((candidate) => candidate.publicSeatId === seat.id);
      const item = existingItem ?? await tx.eventMapOrderItem.create({
        data: {
          contaId: order.contaId,
          orderId: order.id,
          publicSeatId: seat.id,
          lotId: seat.lotId,
          unitPriceSnapshot: seat.unitPrice,
          sectionName: seat.sectionName,
          seatLabel: seat.displayLabel,
          technicalCode: seat.technicalCode,
        },
      });
      const ticket = existingItem?.ticket ?? await tx.eventTicket.create({
        data: {
          contaId: order.contaId,
          eventId: order.eventId,
          eventMapOrderId: order.id,
          orderItemId: item.id,
          ticketCode: createPublicToken('ticket').toUpperCase(),
          checkInCode: createCheckInCode(),
        },
      });
      createdItems.push({ item, ticket, seat });
    }

    const paidAt = params.paidAt ? new Date(params.paidAt) : new Date();
    const confirmedPaymentStatus = params.chargebackStatus?.trim().toUpperCase() === 'REVERSED'
      ? 'REVERSED'
      : params.paymentStatus;
    const lotGroups = new Map<string, typeof publicSeats>();
    for (const seat of publicSeats) {
      if (!seat.lotId) continue;
      const group = lotGroups.get(seat.lotId) ?? [];
      group.push(seat);
      lotGroups.set(seat.lotId, group);
    }

    for (const [lotId, groupSeats] of lotGroups) {
      const lotTotal = groupSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
      const unitPrice = groupSeats.length > 0 ? lotTotal / groupSeats.length : 0;
      const sale = await tx.eventTicketSale.create({
        data: {
          contaId: order.contaId,
          eventId: order.eventId,
          lotId,
          eventMapOrderId: order.id,
          buyerName: order.buyerName,
          quantity: groupSeats.length,
          unitPriceSnapshot: decimal(unitPrice),
          totalAmount: decimal(lotTotal),
          paymentMethod: 'OTHER',
          status: 'PAID',
          paidAt,
          paymentProvider: 'ASAAS',
          asaasPaymentId: params.asaasPaymentId,
          paymentStatus: confirmedPaymentStatus ?? null,
          notes: `Pedido público do mapa ${order.id}`,
        },
      });
      if (lotTotal > 0) {
        const entry = await tx.eventFinancialEntry.create({
          data: {
            contaId: order.contaId,
            eventId: order.eventId,
            type: 'REVENUE',
            category: 'Venda de ingresso',
            description: `Venda pública de ingresso - ${order.map.name}`,
            originType: 'TICKET_SALE',
            originId: sale.id,
            expectedAmount: decimal(lotTotal),
            actualAmount: decimal(lotTotal),
            netAmount: decimal(lotTotal),
            status: 'RECEIVED',
            paymentMethod: 'OTHER',
            realizedAt: paidAt,
            paymentProvider: 'ASAAS',
            asaasPaymentId: params.asaasPaymentId,
            paymentStatus: confirmedPaymentStatus ?? null,
          },
        });
        await tx.eventTicketSale.update({ where: { id: sale.id }, data: { revenueEntryId: entry.id } });
      }
      await syncPublicLotQuantity(tx, order.contaId, lotId);
    }

    await tx.eventMapReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CONSUMED',
        consumedAt: paidAt,
        checkoutKey: null,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
      },
    });

    const updated = await tx.eventMapOrder.update({
      where: { id: order.id },
      data: {
        status: 'CONFIRMED',
        ticketFulfillmentStatus: 'ISSUED',
        ticketFulfillmentAttempts: { increment: 1 },
        ticketFulfillmentLastAttemptAt: new Date(),
        ticketFulfillmentLastError: null,
        ticketFulfilledAt: paidAt,
        asaasPaymentId: order.asaasPaymentId ?? params.asaasPaymentId,
        paymentStatus: confirmedPaymentStatus ?? order.paymentStatus,
        invoiceUrl: params.invoiceUrl ?? order.invoiceUrl,
        paidAt,
        confirmedAt: paidAt,
      },
    });

    await tx.auditLog.create({
      data: {
        contaId: order.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'events.map.public.payment.confirmed',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({
          eventId: order.eventId,
          asaasPaymentId: params.asaasPaymentId,
          ticketsCreated: createdItems.length,
        }),
      },
    });

    await enqueueEventTicketEmail(tx, {
      contaId: order.contaId,
      purchaseId: order.id,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      eventName: `${order.event.name} · ${order.map.name}`,
      eventStartsAt: order.map.startsAt ?? order.event.startsAt,
      eventLocation: [order.map.locationName, order.map.locationAddress].filter(Boolean).join(' — ') || null,
      ticketType: [...new Set(publicSeats.map((seat) => seat.lotName).filter(Boolean))].join(', ') || 'Ingresso',
      ticketCount: createdItems.length,
      ticketsPath: publicOrderTicketsPath(order.id, order.accessToken),
      statusPath: publicOrderStatusPath(order.map.publicSlug, order.id, order.accessToken),
    });

    return {
      orderId: updated.id,
      status: updated.status,
      ticketsCreated: createdItems.length,
    };
  });
}
