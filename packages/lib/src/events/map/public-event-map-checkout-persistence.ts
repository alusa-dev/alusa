import { Prisma, PrismaClient } from '@prisma/client';
import { isPublicEventMapVisible } from '@alusa/domain/events';
import { EventsError, assertEventTicketSalesOpen } from '../events.service';
import { prisma } from '../../prisma';
import { getPublicReservationExpiration } from './public-reservation-policy';
import { decimal, lockPublicEventMapReservation, toAuditJson, toMoney } from './event-map-order-operations';
import type { PublicCheckoutInput } from './event-map.schema';

type DbClient = PrismaClient | Prisma.TransactionClient;

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function normalizeDocument(document: string | null | undefined) {
  return document?.replace(/\D/g, '') ?? '';
}

async function getPublicMapShellOrThrow(db: DbClient, publicSlug: string) {
  const map = await db.eventMap.findFirst({
    where: { publicSlug, status: 'PUBLISHED', publicEnabled: true, publishedVersionId: { not: null } },
    include: {
      event: { select: { id: true, contaId: true, name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true, status: true, finishedAt: true } },
    },
  });
  if (!map || !isPublicEventMapVisible(map)) throw new EventsError('MAPA_PUBLICO_NAO_ENCONTRADO', 'Mapa público não encontrado ou indisponível.', 404);
  return map;
}

/** Creates or reuses the tenant-scoped persistence state required by financial checkout. */
export async function preparePublicEventMapCheckout(publicSlug: string, input: PublicCheckoutInput) {
  const buyerDocument = normalizeDocument(input.buyerDocument);
  if (!buyerDocument) throw new EventsError('DOCUMENTO_OBRIGATORIO', 'Informe o CPF/CNPJ do comprador para gerar a cobrança.', 422);

  return prisma.$transaction(async (tx) => {
    const map = await getPublicMapShellOrThrow(tx, publicSlug);
    await lockPublicEventMapReservation(tx, { contaId: map.contaId, reservationId: input.reservationId });

    const lockedReservation = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EventMapReservation"
      WHERE id = ${input.reservationId}
        AND "holdToken" = ${input.holdToken}
        AND "contaId" = ${map.contaId}
        AND "eventMapId" = ${map.id}
        AND "versionId" = ${map.publishedVersionId!}
        AND status = 'HELD'
      FOR UPDATE
    `;
    if (lockedReservation.length !== 1) throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);

    const reservation = await tx.eventMapReservation.findFirst({
      where: { id: input.reservationId, holdToken: input.holdToken, contaId: map.contaId, eventMapId: map.id, versionId: map.publishedVersionId!, status: 'HELD' },
      include: { seats: { include: { publicSeat: true } }, order: { include: { items: { include: { ticket: true } } } } },
    });
    if (!reservation) throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);
    if (reservation.expiresAt < new Date()) throw new EventsError('RESERVA_EXPIRADA', 'A reserva expirou. Selecione os assentos novamente.', 409);

    const publicSeats = reservation.seats.map((entry) => entry.publicSeat);
    if (publicSeats.length === 0 || publicSeats.some((seat) => seat.status !== 'HELD')) throw new EventsError('RESERVA_INVALIDA', 'A reserva possui assentos indisponíveis.', 409);
    if (!reservation.order) assertEventTicketSalesOpen(map.event);

    const totalAmount = publicSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
    const proposedExpiresAt = getPublicReservationExpiration(new Date(), input.paymentMethod);
    const order = reservation.order ?? await tx.eventMapOrder.upsert({
      where: { reservationId: reservation.id },
      create: {
        contaId: map.contaId, eventId: map.eventId, eventMapId: map.id, versionId: map.publishedVersionId!, reservationId: reservation.id,
        buyerName: input.buyerName, buyerEmail: input.buyerEmail, buyerDocument, buyerPhone: input.buyerPhone, totalAmount: decimal(totalAmount),
        status: 'PAYMENT_PENDING', paymentProvider: 'ASAAS', paymentMethod: input.paymentMethod, expiresAt: proposedExpiresAt, accessToken: createPublicToken('order'),
      },
      update: {},
      include: { items: { include: { ticket: true } } },
    });

    if (['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(order.status)) throw new EventsError('PEDIDO_NAO_REUTILIZAVEL', 'A reserva já foi encerrada. Selecione os assentos novamente.', 409);
    if ((order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' || order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN') &&
      (order.buyerName !== input.buyerName || order.buyerEmail !== input.buyerEmail || order.buyerDocument !== buyerDocument || order.buyerPhone !== input.buyerPhone || order.paymentMethod !== input.paymentMethod)) {
      throw new EventsError('CHECKOUT_EM_RECONCILIACAO', 'Esta tentativa de pagamento ainda está sendo verificada. Mantenha os dados e o meio de pagamento e consulte o pedido novamente.', 409);
    }
    if (order.asaasPaymentId && order.paymentMethod !== input.paymentMethod) throw new EventsError('METODO_PAGAMENTO_FIXO', 'A cobrança deste pedido já foi gerada com outro meio de pagamento. Cancele o pedido e inicie uma nova compra para alterá-lo.', 409);

    const expiresAt = order.asaasPaymentId ? order.expiresAt ?? proposedExpiresAt : proposedExpiresAt;
    await tx.eventMapReservation.update({ where: { id: reservation.id }, data: { status: 'HELD', expiresAt, buyerName: input.buyerName, buyerEmail: input.buyerEmail } });
    if (order.buyerName !== input.buyerName || order.buyerEmail !== input.buyerEmail || order.buyerDocument !== buyerDocument || order.buyerPhone !== input.buyerPhone || order.paymentMethod !== input.paymentMethod || order.expiresAt?.getTime() !== expiresAt.getTime()) {
      await tx.eventMapOrder.update({ where: { id: order.id }, data: { buyerName: input.buyerName, buyerEmail: input.buyerEmail, buyerDocument, buyerPhone: input.buyerPhone, paymentMethod: input.paymentMethod, expiresAt } });
    }
    await tx.auditLog.create({ data: { contaId: map.contaId, actorType: 'SYSTEM', actorId: null, action: 'events.map.public.checkout', entityType: 'EventMapOrder', entityId: order.id, metadata: toAuditJson({ eventId: map.eventId, eventMapId: map.id, versionId: map.publishedVersionId, seats: publicSeats.map((seat) => seat.technicalCode), totalAmount, expiresAt: expiresAt.toISOString() }) } });
    return { order, map, publicSeats, totalAmount, expiresAt };
  });
}
