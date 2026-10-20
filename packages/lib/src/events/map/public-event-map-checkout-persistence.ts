import { Prisma, PrismaClient } from '@prisma/client';
import { isPublicEventMapVisible } from '@alusa/domain/events';
import { EventsError, assertEventTicketSalesOpen } from '../events.service';
import { prisma } from '../../prisma';
import { getPublicReservationExpiration } from './public-reservation-policy';
import { decimal, lockEventMapForReservation, lockPublicEventMapReservation, toAuditJson, toMoney } from './event-map-order-operations';
import { eventMapDateToLocalDateTime, eventMapLocalDateTimeToDate, type PublicCheckoutInput } from './event-map.schema';

type DbClient = PrismaClient | Prisma.TransactionClient;

function snapshotString(snapshot: Prisma.JsonValue, key: string) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = (snapshot as Prisma.JsonObject)[key];
  return typeof value === 'string' ? value : null;
}

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function normalizeDocument(document: string | null | undefined) {
  return document?.replace(/\D/g, '') ?? '';
}

function assertReservationSeatsBelongToPublishedMap(
  reservation: {
    id: string;
    contaId: string;
    eventId: string;
    eventMapId: string;
    versionId: string;
    seats: Array<{
      contaId: string;
      reservationId: string;
      publicSeatId: string;
      publicSeat: { id: string; contaId: string; eventId: string; eventMapId: string; versionId: string };
    }>;
  },
  map: { contaId: string; eventId: string; id: string; publishedVersionId: string | null },
) {
  if (
    reservation.contaId !== map.contaId ||
    reservation.eventId !== map.eventId ||
    reservation.eventMapId !== map.id ||
    reservation.versionId !== map.publishedVersionId ||
    reservation.seats.some(({ contaId, reservationId, publicSeatId, publicSeat }) =>
      contaId !== map.contaId ||
      reservationId !== reservation.id ||
      publicSeatId !== publicSeat.id ||
      publicSeat.contaId !== map.contaId ||
      publicSeat.eventId !== map.eventId ||
      publicSeat.eventMapId !== map.id ||
      publicSeat.versionId !== map.publishedVersionId
    )
  ) {
    throw new EventsError('RESERVA_INVALIDA', 'A reserva contém assentos incompatíveis com o mapa publicado.', 409);
  }
}

function assertOrderItemsBelongToReservation(
  order: {
    id: string;
    contaId: string;
    eventId: string;
    eventMapId: string;
    versionId: string;
    items: Array<{
      id: string;
      contaId: string;
      orderId: string;
      publicSeatId: string;
      ticket: { contaId: string; eventId: string; eventMapOrderId: string | null; orderItemId: string | null } | null;
    }>;
  },
  map: { contaId: string; eventId: string; id: string; publishedVersionId: string | null },
  reservationSeatIds: Set<string>,
) {
  if (
    order.contaId !== map.contaId ||
    order.eventId !== map.eventId ||
    order.eventMapId !== map.id ||
    order.versionId !== map.publishedVersionId ||
    order.items.some((item) =>
      item.contaId !== map.contaId ||
      item.orderId !== order.id ||
      !reservationSeatIds.has(item.publicSeatId) ||
      (item.ticket !== null && (
        item.ticket.contaId !== map.contaId ||
        item.ticket.eventId !== map.eventId ||
        item.ticket.eventMapOrderId !== order.id ||
        item.ticket.orderItemId !== item.id
      ))
    )
  ) {
    throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado para esta reserva.', 404);
  }
}

async function getPublicMapShellOrThrow(db: DbClient, publicSlug: string) {
  const map = await db.eventMap.findFirst({
    where: { publicSlug, status: 'PUBLISHED', publicEnabled: true, publishedVersionId: { not: null } },
    include: {
      event: { select: { id: true, contaId: true, name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true, status: true, finishedAt: true } },
    },
  });
  if (!map || !isPublicEventMapVisible(map)) throw new EventsError('MAPA_PUBLICO_NAO_ENCONTRADO', 'Mapa público não encontrado ou indisponível.', 404);
  if (map.event.contaId !== map.contaId || map.event.id !== map.eventId) {
    throw new EventsError('MAPA_PUBLICO_NAO_ENCONTRADO', 'Mapa público não encontrado ou indisponível.', 404);
  }
  return map;
}

/** Creates or reuses the tenant-scoped persistence state required by financial checkout. */
export async function preparePublicEventMapCheckout(publicSlug: string, input: PublicCheckoutInput) {
  const buyerDocument = normalizeDocument(input.buyerDocument);
  if (!buyerDocument) throw new EventsError('DOCUMENTO_OBRIGATORIO', 'Informe o CPF/CNPJ do comprador para gerar a cobrança.', 422);

  return prisma.$transaction(async (tx) => {
    const initialMap = await getPublicMapShellOrThrow(tx, publicSlug);
    const expectedVersionId = initialMap.publishedVersionId!;
    if (!await lockEventMapForReservation(tx, { contaId: initialMap.contaId, eventMapId: initialMap.id })) {
      throw new EventsError('MAPA_PUBLICO_NAO_ENCONTRADO', 'Mapa público não encontrado ou indisponível.', 404);
    }
    const map = await getPublicMapShellOrThrow(tx, publicSlug);
    if (map.id !== initialMap.id || map.publishedVersionId !== expectedVersionId || !map.publicEnabled) {
      throw new EventsError('MAPA_VERSAO_ALTERADA', 'A versão pública do mapa mudou. Atualize a página e selecione os assentos novamente.', 409);
    }
    const publishedVersion = await tx.eventMapVersion.findFirst({
      where: { id: expectedVersionId, contaId: map.contaId, eventMapId: map.id, status: 'PUBLISHED' },
      select: { snapshot: true },
    });
    if (!publishedVersion) {
      throw new EventsError('MAPA_VERSAO_ALTERADA', 'A versão pública do mapa não está disponível. Atualize a página e tente novamente.', 409);
    }
    const startsAtLocal = snapshotString(publishedVersion.snapshot, 'startsAtLocal')
      ?? eventMapDateToLocalDateTime(snapshotString(publishedVersion.snapshot, 'startsAt'));
    await lockPublicEventMapReservation(tx, { contaId: map.contaId, reservationId: input.reservationId });

    const lockedReservation = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text AS status FROM "EventMapReservation"
      WHERE id = ${input.reservationId}
        AND "holdToken" = ${input.holdToken}
        AND "contaId" = ${map.contaId}
        AND "eventId" = ${map.eventId}
        AND "eventMapId" = ${map.id}
        AND "versionId" = ${map.publishedVersionId!}
      FOR UPDATE
    `;
    if (lockedReservation.length !== 1) throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);

    if (lockedReservation[0].status !== 'HELD') {
      const finalizedReservation = await tx.eventMapReservation.findFirst({
        where: {
          id: input.reservationId,
          holdToken: input.holdToken,
          contaId: map.contaId,
          eventId: map.eventId,
          eventMapId: map.id,
          versionId: map.publishedVersionId!,
        },
        include: {
          seats: { include: { publicSeat: { include: { orderItems: { select: { id: true } }, saleSeats: { select: { id: true } } } } } },
          order: { include: { items: { include: { ticket: true } } } },
        },
      });
      const finalizedOrder = finalizedReservation?.order;
      if (!finalizedReservation || !finalizedOrder) {
        throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);
      }
      if (
        finalizedOrder.contaId !== map.contaId ||
        finalizedOrder.reservationId !== finalizedReservation.id ||
        finalizedOrder.eventId !== map.eventId ||
        finalizedOrder.eventMapId !== map.id ||
        finalizedOrder.versionId !== map.publishedVersionId
      ) {
        throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado para esta reserva.', 404);
      }
      if (finalizedOrder.status !== 'CONFIRMED' || !finalizedOrder.asaasPaymentId) {
        throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);
      }
      assertReservationSeatsBelongToPublishedMap(finalizedReservation, map);
      assertOrderItemsBelongToReservation(
        finalizedOrder,
        map,
        new Set(finalizedReservation.seats.map((entry) => entry.publicSeatId)),
      );
      if (!eventMapLocalDateTimeToDate(startsAtLocal)) {
        throw new EventsError('HORARIO_SESSAO_INVALIDO', 'O horário desta sessão é inválido.', 409);
      }
      const publicSeats = finalizedReservation.seats.map((entry) => entry.publicSeat);
      return {
        order: finalizedOrder,
        map,
        publishedMapSchedule: {
          startsAt: snapshotString(publishedVersion.snapshot, 'startsAt'),
          startsAtLocal,
        },
        publicSeats,
        totalAmount: publicSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0),
        expiresAt: finalizedOrder.expiresAt ?? finalizedReservation.expiresAt,
      };
    }

    const reservation = await tx.eventMapReservation.findFirst({
      where: { id: input.reservationId, holdToken: input.holdToken, contaId: map.contaId, eventId: map.eventId, eventMapId: map.id, versionId: map.publishedVersionId!, status: 'HELD' },
      include: { seats: { include: { publicSeat: { include: { orderItems: { select: { id: true } }, saleSeats: { select: { id: true } } } } } }, order: { include: { items: { include: { ticket: true } } } } },
    });
    if (!reservation) throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);
    assertReservationSeatsBelongToPublishedMap(reservation, map);
    if (!eventMapLocalDateTimeToDate(startsAtLocal)) throw new EventsError('HORARIO_SESSAO_INVALIDO', 'O horário desta sessão é inválido.', 409);
    const publicSeats = reservation.seats.map((entry) => entry.publicSeat);
    if (publicSeats.length === 0 || publicSeats.some((seat) => seat.status !== 'HELD' || seat.orderItems.length > 0 || seat.saleSeats.length > 0)) throw new EventsError('RESERVA_INVALIDA', 'A reserva possui assentos indisponíveis.', 409);
    if (reservation.order) {
      if (
        reservation.order.contaId !== map.contaId ||
        reservation.order.reservationId !== reservation.id ||
        reservation.order.eventId !== map.eventId ||
        reservation.order.eventMapId !== map.id ||
        reservation.order.versionId !== map.publishedVersionId
      ) {
        throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado para esta reserva.', 404);
      }
      assertOrderItemsBelongToReservation(
        reservation.order,
        map,
        new Set(reservation.seats.map((entry) => entry.publicSeatId)),
      );
    }
    if (!reservation.order) assertEventTicketSalesOpen(map.event);

    const totalAmount = publicSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
    const proposedExpiresAt = getPublicReservationExpiration(new Date(), input.paymentMethod);
    const order = reservation.order ?? await tx.eventMapOrder.upsert({
      where: { reservationId: reservation.id },
      create: {
        contaId: map.contaId, eventId: map.eventId, eventMapId: map.id, versionId: map.publishedVersionId!, reservationId: reservation.id,
        buyerName: input.buyerName, buyerEmail: input.buyerEmail, buyerDocument, buyerPhone: input.buyerPhone,
        ...(input.whatsappConsent ? { whatsappOptInAt: new Date(), whatsappOptInSource: 'PUBLIC_CHECKOUT' } : {}), totalAmount: decimal(totalAmount),
        status: 'PAYMENT_PENDING', paymentProvider: 'ASAAS', paymentMethod: input.paymentMethod, expiresAt: proposedExpiresAt, accessToken: createPublicToken('order'),
      },
      update: {},
      include: { items: { include: { ticket: true } } },
    });

    // `reservation.order` follows a globally unique reservationId relation,
    // not a tenant-composite relation. Fail closed if legacy/manual data links
    // an order owned by another account before any order or audit mutation.
    if (
      order.contaId !== map.contaId ||
      order.reservationId !== reservation.id ||
      order.eventId !== map.eventId ||
      order.eventMapId !== map.id ||
      order.versionId !== map.publishedVersionId
    ) {
      throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado para esta reserva.', 404);
    }

    if (['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(order.status)) throw new EventsError('PEDIDO_NAO_REUTILIZAVEL', 'A reserva já foi encerrada. Selecione os assentos novamente.', 409);
    const expired = reservation.expiresAt < new Date();
    if (expired && (order.paymentStatus !== 'PAYMENT_CREATION_UNKNOWN' || order.asaasPaymentId)) {
      throw new EventsError('RESERVA_EXPIRADA', 'A reserva expirou. Selecione os assentos novamente.', 409);
    }
    if (expired) assertEventTicketSalesOpen(map.event);
    const buyerIdentityChanged = order.buyerName !== input.buyerName ||
      order.buyerEmail !== input.buyerEmail ||
      order.buyerDocument !== buyerDocument ||
      order.buyerPhone !== input.buyerPhone;
    if (buyerIdentityChanged) {
      throw new EventsError(
        order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' || order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN'
          ? 'CHECKOUT_EM_RECONCILIACAO'
          : 'IDENTIDADE_DO_COMPRADOR_FIXA',
        order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' || order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN'
          ? 'Esta tentativa de pagamento ainda está sendo verificada. Mantenha os dados do comprador e consulte o pedido novamente.'
          : 'Os dados do comprador deste pedido não podem ser alterados. Inicie uma nova compra para usar outra identidade.',
        409,
      );
    }
    if (order.paymentMethod && order.paymentMethod !== input.paymentMethod) {
      throw new EventsError('METODO_PAGAMENTO_FIXO', 'O meio de pagamento deste pedido já está definido. Inicie uma nova compra para alterá-lo.', 409);
    }

    const expiresAt = order.asaasPaymentId ? order.expiresAt ?? proposedExpiresAt : proposedExpiresAt;
    const now = new Date();
    const isRevokingWhatsAppConsent = !input.whatsappConsent && Boolean(order.whatsappOptInAt) && !order.whatsappOptOutAt;
    const isRenewingWhatsAppConsent = input.whatsappConsent && (!order.whatsappOptInAt || Boolean(order.whatsappOptOutAt));
    await tx.eventMapReservation.update({ where: { id: reservation.id }, data: { status: 'HELD', expiresAt } });
    await tx.eventMapOrder.update({
      where: { id: order.id },
      data: {
        expiresAt,
        ...(isRenewingWhatsAppConsent
          ? { whatsappOptInAt: now, whatsappOptInSource: 'PUBLIC_CHECKOUT', whatsappOptOutAt: null, whatsappOptOutSource: null }
          : isRevokingWhatsAppConsent
            ? { whatsappOptOutAt: now, whatsappOptOutSource: 'PUBLIC_CHECKOUT' }
          : {}),
      },
    });
    if (isRevokingWhatsAppConsent) {
      await tx.auditLog.create({ data: {
        contaId: map.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'events.map.public.checkout.whatsapp_consent_revoked',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({ eventId: map.eventId, reservationId: reservation.id, consentSource: 'PUBLIC_CHECKOUT' }),
      } });
    } else if (isRenewingWhatsAppConsent) {
      await tx.auditLog.create({ data: {
        contaId: map.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: order.whatsappOptOutAt
          ? 'events.map.public.checkout.whatsapp_consent_renewed'
          : 'events.map.public.checkout.whatsapp_consent_granted',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({ eventId: map.eventId, reservationId: reservation.id, consentSource: 'PUBLIC_CHECKOUT' }),
      } });
    }
    await tx.auditLog.create({ data: { contaId: map.contaId, actorType: 'SYSTEM', actorId: null, action: expired ? 'events.map.public.checkout.hold_resumed' : 'events.map.public.checkout', entityType: 'EventMapOrder', entityId: order.id, metadata: toAuditJson({ eventId: map.eventId, eventMapId: map.id, versionId: map.publishedVersionId, reservationId: reservation.id, seats: publicSeats.map((seat) => seat.technicalCode), totalAmount, expiresAt: expiresAt.toISOString() }) } });
    return {
      order,
      map,
      publishedMapSchedule: {
        startsAt: snapshotString(publishedVersion.snapshot, 'startsAt'),
        startsAtLocal,
      },
      publicSeats,
      totalAmount,
      expiresAt,
    };
  });
}
