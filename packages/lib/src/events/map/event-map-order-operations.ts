import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';

/** Shared transaction lock used by reservation mutations and paid-order confirmation. */
export async function lockPublicEventMapReservation(
  tx: Prisma.TransactionClient,
  input: { contaId: string; reservationId: string },
) {
  const key = `public-event-map-reservation:${input.contaId}:${input.reservationId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Domain persistence operation shared by finance cancellation and checkout failure recovery. */
export async function cancelPublicEventMapOrder(
  contaId: string,
  orderId: string,
  reason?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.eventMapOrder.findFirst({
      where: { id: orderId, contaId },
      select: { reservationId: true },
    });
    if (!candidate) return { ok: true };
    if (candidate.reservationId) {
      await lockPublicEventMapReservation(tx, { contaId, reservationId: candidate.reservationId });
    }
    const order = await tx.eventMapOrder.findFirst({
      where: { id: orderId, contaId },
      include: { reservation: { include: { seats: true } } },
    });
    if (
      !order
      || order.status === 'CANCELLED'
      || order.status === 'EXPIRED'
      || order.status === 'CONFIRMED'
      || order.status === 'REFUNDED'
    ) return { ok: true };

    const seatIds = order.reservation?.seats.map((seat) => seat.publicSeatId) ?? [];
    if (seatIds.length > 0) {
      await tx.eventMapPublicSeat.updateMany({
        where: { contaId: order.contaId, id: { in: seatIds }, status: 'HELD' },
        data: { status: 'AVAILABLE' },
      });
    }
    if (order.reservationId) {
      await tx.eventMapReservation.updateMany({
        where: { id: order.reservationId, contaId: order.contaId, status: 'HELD' },
        data: { status: 'CANCELLED', checkoutKey: null },
      });
    }
    await tx.eventMapOrder.update({
      where: { id: order.id, contaId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'events.map.public.order.cancelled',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({ eventId: order.eventId, reason: reason ?? null }),
      },
    });
    return { ok: true };
  });
}

export function parseEventMapOrderExternalReference(externalReference: string | null | undefined) {
  const prefix = 'event-map-order:';
  if (!externalReference?.startsWith(prefix)) return null;
  const orderId = externalReference.slice(prefix.length).trim();
  return orderId.length > 0 ? orderId : null;
}

/**
 * Resolve a provider payment to one local order without combining independent
 * identifiers in an ambiguous OR. A conflicting external reference fails closed.
 */
export async function findEventMapOrderForPayment(
  db: Pick<Prisma.TransactionClient, 'eventMapOrder'>,
  params: { contaId: string; asaasPaymentId: string; externalReference?: string | null },
) {
  const orderId = parseEventMapOrderExternalReference(params.externalReference);
  const byPaymentId = await db.eventMapOrder.findFirst({
    where: { contaId: params.contaId, asaasPaymentId: params.asaasPaymentId },
    select: { id: true, reservationId: true, asaasPaymentId: true },
  });
  if (!orderId) return byPaymentId;

  const byExternalReference = await db.eventMapOrder.findFirst({
    where: { id: orderId, contaId: params.contaId },
    select: { id: true, reservationId: true, asaasPaymentId: true },
  });
  if (!byExternalReference) return null;
  if (byExternalReference.asaasPaymentId && byExternalReference.asaasPaymentId !== params.asaasPaymentId) return null;
  if (byPaymentId && byPaymentId.id !== byExternalReference.id) return null;
  return byExternalReference;
}

export function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  const parsed = value instanceof Prisma.Decimal ? value.toNumber() : typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

export function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function normalizeTicketFulfillmentError(reason: string | null | undefined) {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 500) : 'Falha ao emitir ingressos do pedido público.';
}

export async function syncPublicLotQuantity(tx: Prisma.TransactionClient, contaId: string, lotId: string) {
  const lockedLots = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "EventTicketLot"
    WHERE id = ${lotId} AND "contaId" = ${contaId}
    FOR UPDATE
  `;
  if (lockedLots.length !== 1) return;

  const lot = await tx.eventTicketLot.findFirst({ where: { id: lotId, contaId } });
  if (!lot) return;
  const aggregate = await tx.eventTicketSale.aggregate({
    where: { contaId, lotId, status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] } },
    _sum: { quantity: true },
  });

  const quantitySold = aggregate._sum.quantity ?? 0;
  const nextStatus =
    lot.status === 'ACTIVE' && quantitySold >= lot.quantityTotal
      ? 'SOLD_OUT'
      : lot.status === 'SOLD_OUT' && quantitySold < lot.quantityTotal
        ? 'ACTIVE'
        : lot.status;
  await tx.eventTicketLot.update({
    where: { id: lot.id },
    data: { quantitySold, status: nextStatus },
  });
}

/** Releases inventory and cancels the valid tickets linked to a refunded staff sale. */
export async function releaseSeatsForTicketSale(tx: Prisma.TransactionClient, contaId: string, saleId: string) {
  const saleSeats = await tx.eventTicketSaleSeat.findMany({
    where: { contaId, saleId },
    select: { publicSeatId: true, ticket: { select: { id: true } } },
  });
  if (saleSeats.length === 0) return;

  const seatIds = saleSeats.map((entry) => entry.publicSeatId);
  await tx.eventMapPublicSeat.updateMany({
    where: { contaId, id: { in: seatIds }, status: 'SOLD' },
    data: { status: 'AVAILABLE' },
  });

  const ticketIds = saleSeats.map((entry) => entry.ticket?.id).filter((id): id is string => Boolean(id));
  if (ticketIds.length > 0) {
    await tx.eventTicket.updateMany({
      where: { contaId, id: { in: ticketIds }, status: 'VALID' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
