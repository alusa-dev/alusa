import { Prisma } from '@prisma/client';

import {
  groupStaffSeatsByLot,
  STAFF_SEAT_RESERVATION_TTL_MINUTES,
  canPrintStaffSaleTickets,
  validateStaffSeatSelection,
} from '@alusa/domain';

import { prisma } from '../../prisma';
import { assertEventScopedTicketSaleLinks } from '../event-participant-scope';
import { EventsError, type EventsContext } from '../events.service';
import type { CreateTicketSaleInput } from '../events.schema';

type DbClient = Prisma.TransactionClient | typeof prisma;

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function createLocalId(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function snapshotRecord(snapshot: Prisma.JsonValue) {
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : {};
}

function mapStaffSeat(seat: {
  id: string;
  originalSeatId: string;
  levelId: string | null;
  sectionId: string | null;
  sectionName: string;
  lotId: string | null;
  lotName: string | null;
  unitPrice: Prisma.Decimal;
  technicalCode: string;
  displayLabel: string;
  rowLabel: string | null;
  seatNumber: string | null;
  status: string;
  accessible: boolean;
  publicVisible: boolean;
  x: Prisma.Decimal;
  y: Prisma.Decimal;
  size: Prisma.Decimal | null;
  rotation: Prisma.Decimal;
  metadata: Prisma.JsonValue;
}) {
  const metadata =
    seat.metadata && typeof seat.metadata === 'object' && !Array.isArray(seat.metadata)
      ? (seat.metadata as Record<string, unknown>)
      : {};

  return {
    id: seat.id,
    originalSeatId: seat.originalSeatId,
    levelId: seat.levelId,
    sectionId: seat.sectionId,
    groupId: typeof metadata.groupId === 'string' ? metadata.groupId : null,
    rowIndex: typeof metadata.rowIndex === 'number' ? metadata.rowIndex : null,
    columnIndex: typeof metadata.columnIndex === 'number' ? metadata.columnIndex : null,
    sectionName: seat.sectionName,
    lotId: seat.lotId,
    lotName: seat.lotName,
    unitPrice: toMoney(seat.unitPrice),
    technicalCode: seat.technicalCode,
    displayLabel: seat.displayLabel,
    rowLabel: seat.rowLabel,
    seatNumber: seat.seatNumber,
    status: seat.status,
    accessible: seat.accessible,
    publicVisible: seat.publicVisible,
    x: toNumber(seat.x),
    y: toNumber(seat.y),
    size: seat.size == null ? null : toNumber(seat.size),
    rotation: toNumber(seat.rotation),
  };
}

async function expireStaffReservations(db: DbClient, contaId: string, now = new Date()) {
  const expired = await db.eventMapReservation.findMany({
    where: {
      contaId,
      source: 'STAFF_MANUAL',
      status: 'HELD',
      expiresAt: { lt: now },
    },
    include: { seats: { select: { publicSeatId: true } } },
  });
  if (expired.length === 0) return;

  const expiredSeatIds = [...new Set(expired.flatMap((reservation) => reservation.seats.map((seat) => seat.publicSeatId)))];
  if (expiredSeatIds.length > 0) {
    await db.eventMapPublicSeat.updateMany({
      where: { contaId, id: { in: expiredSeatIds }, status: 'HELD' },
      data: { status: 'AVAILABLE' },
    });
  }
  await db.eventMapReservation.updateMany({
    where: { contaId, id: { in: expired.map((reservation) => reservation.id) }, status: 'HELD' },
    data: { status: 'EXPIRED', checkoutKey: null },
  });
}

async function getPublishedStaffMapOrThrow(db: DbClient, contaId: string, eventId: string, mapId: string) {
  const map = await db.eventMap.findFirst({
    where: { id: mapId, contaId, eventId, status: 'PUBLISHED', publishedVersionId: { not: null } },
    include: {
      event: {
        select: {
          id: true,
          contaId: true,
          name: true,
          startsAt: true,
          endsAt: true,
          status: true,
          ticketMode: true,
        },
      },
    },
  });
  if (!map?.publishedVersionId) {
    throw new EventsError('MAPA_NAO_PUBLICADO', 'Publique o mapa antes de vender assentos na secretaria.', 409);
  }
  if (map.event.ticketMode !== 'NUMBERED_SEATS') {
    throw new EventsError('EVENTO_SEM_ASSENTOS_NUMERADOS', 'Este evento não usa assentos numerados.', 409);
  }
  return map;
}

function mapStaffReservationResult(
  reservation: { id: string; holdToken: string; expiresAt: Date },
  seats: ReturnType<typeof mapStaffSeat>[],
) {
  return {
    reservationId: reservation.id,
    holdToken: reservation.holdToken,
    expiresAt: reservation.expiresAt.toISOString(),
    seats,
    totalAmount: seats.reduce((sum, seat) => sum + seat.unitPrice, 0),
  };
}

export async function getStaffEventMapSalesView(ctx: Pick<EventsContext, 'contaId'>, eventId: string, mapId: string) {
  const map = await getPublishedStaffMapOrThrow(prisma, ctx.contaId, eventId, mapId);
  const version = await prisma.eventMapVersion.findFirst({
    where: { id: map.publishedVersionId!, contaId: ctx.contaId, eventMapId: map.id },
  });
  if (!version) throw new EventsError('VERSAO_PUBLICA_NAO_ENCONTRADA', 'Versão publicada não encontrada.', 404);

  const seats = await prisma.eventMapPublicSeat.findMany({
    where: { contaId: ctx.contaId, versionId: version.id },
    orderBy: [{ sectionName: 'asc' }, { rowLabel: 'asc' }, { seatNumber: 'asc' }, { displayLabel: 'asc' }],
  });
  const snapshot = snapshotRecord(version.snapshot);

  return {
    mapId: map.id,
    versionId: version.id,
    version: version.version,
    name: map.name,
    publishedAt: version.publishedAt.toISOString(),
    event: {
      id: map.event.id,
      name: map.event.name,
      startsAt: map.event.startsAt.toISOString(),
      endsAt: map.event.endsAt?.toISOString() ?? null,
      status: map.event.status,
      ticketMode: map.event.ticketMode,
    },
    levels: Array.isArray(snapshot.levels) ? snapshot.levels : [],
    sections: Array.isArray(snapshot.sections) ? snapshot.sections : [],
    objects: Array.isArray(snapshot.objects) ? snapshot.objects : [],
    seatGroups: Array.isArray(snapshot.seatGroups) ? snapshot.seatGroups : [],
    seats: seats.map(mapStaffSeat),
    counts: {
      seats: seats.length,
      availableSeats: seats.filter((seat) => seat.status === 'AVAILABLE').length,
      soldSeats: seats.filter((seat) => seat.status === 'SOLD').length,
      heldSeats: seats.filter((seat) => seat.status === 'HELD').length,
    },
  };
}

export type StaffEventMapSalesViewDTO = Awaited<ReturnType<typeof getStaffEventMapSalesView>>;

async function applyStaffSeatHold(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    versionId: string;
    seatIds: string[];
    ownHeldSeatIds: string[];
  },
) {
  const seats = await tx.eventMapPublicSeat.findMany({
    where: { contaId: params.contaId, versionId: params.versionId, id: { in: params.seatIds } },
  });
  const selection = validateStaffSeatSelection({
    requestedSeatIds: params.seatIds,
    seats: seats.map((seat) => ({ id: seat.id, status: seat.status, lotId: seat.lotId, unitPrice: toMoney(seat.unitPrice) })),
    ownHeldSeatIds: params.ownHeldSeatIds,
  });
  if (!selection.ok) throw new EventsError('ASSENTOS_INDISPONIVEIS', selection.reason, 409);

  const toRelease = params.ownHeldSeatIds.filter((seatId) => !selection.seatIds.includes(seatId));
  if (toRelease.length > 0) {
    await tx.eventMapPublicSeat.updateMany({
      where: { contaId: params.contaId, versionId: params.versionId, id: { in: toRelease }, status: 'HELD' },
      data: { status: 'AVAILABLE' },
    });
  }

  const toHold = selection.seatIds.filter((seatId) => !params.ownHeldSeatIds.includes(seatId));
  if (toHold.length > 0) {
    const lockedRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EventMapPublicSeat"
      WHERE "contaId" = ${params.contaId}
        AND "versionId" = ${params.versionId}
        AND id IN (${Prisma.join(toHold)})
        AND status = 'AVAILABLE'
      FOR UPDATE
    `;
    if (lockedRows.length !== toHold.length) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos acabaram de ser reservados.', 409);
    }
    const updated = await tx.eventMapPublicSeat.updateMany({
      where: { contaId: params.contaId, versionId: params.versionId, id: { in: toHold }, status: 'AVAILABLE' },
      data: { status: 'HELD' },
    });
    if (updated.count !== toHold.length) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos ficaram indisponíveis.', 409);
    }
  }

  return seats.filter((seat) => selection.seatIds.includes(seat.id)).map(mapStaffSeat);
}

export async function reserveStaffEventMapSeats(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: { seatIds: string[]; holdToken?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const map = await getPublishedStaffMapOrThrow(tx, ctx.contaId, eventId, mapId);
    await expireStaffReservations(tx, ctx.contaId);
    const versionId = map.publishedVersionId!;

    if (input.holdToken) {
      const existing = await tx.eventMapReservation.findFirst({
        where: {
          contaId: ctx.contaId,
          holdToken: input.holdToken,
          source: 'STAFF_MANUAL',
          eventMapId: map.id,
          versionId,
        },
        include: { seats: { include: { publicSeat: true } } },
      });
      if (!existing || existing.status !== 'HELD' || existing.expiresAt < new Date()) {
        throw new EventsError('RESERVA_INVALIDA', 'Reserva da secretaria expirou. Escolha os assentos novamente.', 409);
      }
      if (existing.createdByUserId && existing.createdByUserId !== ctx.userId) {
        throw new EventsError('RESERVA_INVALIDA', 'Esta reserva pertence a outro usuário.', 403);
      }

      const ownHeldSeatIds = existing.seats.map((entry) => entry.publicSeatId);
      const selectedSeats = await applyStaffSeatHold(tx, {
        contaId: ctx.contaId,
        versionId,
        seatIds: input.seatIds,
        ownHeldSeatIds,
      });

      const expiresAt = addMinutes(new Date(), STAFF_SEAT_RESERVATION_TTL_MINUTES);
      const reservation = await tx.eventMapReservation.update({
        where: { id: existing.id },
        data: { expiresAt },
      });

      await tx.eventMapReservationSeat.deleteMany({
        where: { reservationId: existing.id, publicSeatId: { notIn: input.seatIds } },
      });
      const existingSeatIds = new Set(existing.seats.map((entry) => entry.publicSeatId));
      const newSeatIds = input.seatIds.filter((seatId) => !existingSeatIds.has(seatId));
      if (newSeatIds.length > 0) {
        await tx.eventMapReservationSeat.createMany({
          data: newSeatIds.map((publicSeatId) => ({
            id: createLocalId('reservationseat'),
            contaId: ctx.contaId,
            reservationId: existing.id,
            publicSeatId,
          })),
        });
      }

      return mapStaffReservationResult(reservation, selectedSeats);
    }

    const selectedSeats = await applyStaffSeatHold(tx, {
      contaId: ctx.contaId,
      versionId,
      seatIds: input.seatIds,
      ownHeldSeatIds: [],
    });

    const expiresAt = addMinutes(new Date(), STAFF_SEAT_RESERVATION_TTL_MINUTES);
    const reservation = await tx.eventMapReservation.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        eventMapId: map.id,
        versionId,
        holdToken: createPublicToken('staffhold'),
        checkoutKey: `staff:${createLocalId('session')}`,
        source: 'STAFF_MANUAL',
        status: 'HELD',
        expiresAt,
        createdByUserId: ctx.userId,
      },
    });

    await tx.eventMapReservationSeat.createMany({
      data: input.seatIds.map((publicSeatId) => ({
        id: createLocalId('reservationseat'),
        contaId: ctx.contaId,
        reservationId: reservation.id,
        publicSeatId,
      })),
    });

    return mapStaffReservationResult(reservation, selectedSeats);
  });
}

export async function releaseStaffEventMapReservation(ctx: EventsContext, eventId: string, holdToken: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.eventMapReservation.findFirst({
      where: {
        contaId: ctx.contaId,
        eventId,
        holdToken,
        source: 'STAFF_MANUAL',
        status: 'HELD',
      },
      include: { seats: { select: { publicSeatId: true } } },
    });
    if (!reservation) return { released: false };

    if (reservation.createdByUserId && reservation.createdByUserId !== ctx.userId) {
      throw new EventsError('RESERVA_INVALIDA', 'Esta reserva pertence a outro usuário.', 403);
    }

    const seatIds = reservation.seats.map((seat) => seat.publicSeatId);
    if (seatIds.length > 0) {
      await tx.eventMapPublicSeat.updateMany({
        where: { contaId: ctx.contaId, id: { in: seatIds }, status: 'HELD' },
        data: { status: 'AVAILABLE' },
      });
    }
    await tx.eventMapReservation.update({
      where: { id: reservation.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), checkoutKey: null },
    });
    return { released: true };
  });
}

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

export async function createSeatedTicketSale(ctx: EventsContext, input: CreateTicketSaleInput & { holdToken: string }) {
  return prisma.$transaction(async (tx) => {
    await expireStaffReservations(tx, ctx.contaId);

    const reservation = await tx.eventMapReservation.findFirst({
      where: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        holdToken: input.holdToken,
        source: 'STAFF_MANUAL',
        status: 'HELD',
      },
      include: {
        seats: { include: { publicSeat: true } },
        event: { select: { id: true, status: true, ticketMode: true } },
      },
    });

    if (!reservation) {
      throw new EventsError('RESERVA_INVALIDA', 'Reserva de assentos não encontrada ou expirada.', 409);
    }
    if (reservation.expiresAt < new Date()) {
      throw new EventsError('RESERVA_EXPIRADA', 'A reserva de assentos expirou. Escolha novamente.', 409);
    }
    if (reservation.createdByUserId && reservation.createdByUserId !== ctx.userId) {
      throw new EventsError('RESERVA_INVALIDA', 'Esta reserva pertence a outro usuário.', 403);
    }
    if (reservation.event.ticketMode !== 'NUMBERED_SEATS') {
      throw new EventsError('EVENTO_SEM_ASSENTOS_NUMERADOS', 'Este evento não usa assentos numerados.', 409);
    }
    if (['CANCELLED', 'ARCHIVED', 'FINISHED'].includes(reservation.event.status)) {
      throw new EventsError('EVENTO_BLOQUEADO', 'Este evento não aceita novas alterações operacionais.', 409);
    }

    const publicSeats = reservation.seats.map((entry) => entry.publicSeat);
    if (publicSeats.length === 0) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Nenhum assento selecionado na reserva.', 409);
    }
    if (publicSeats.some((seat) => seat.status !== 'HELD' || !seat.lotId)) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos não estão mais reservados.', 409);
    }

    const saleStatus = input.paymentMethod === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : input.status;
    if (!['PENDING', 'PAID', 'COMPLIMENTARY'].includes(saleStatus)) {
      throw new EventsError('STATUS_VENDA_INVALIDO', 'Use pendente, pago ou cortesia ao criar venda.', 422);
    }

    await assertEventScopedTicketSaleLinks(tx, ctx.contaId, input.eventId, {
      alunoId: input.alunoId,
      responsavelId: input.responsavelId,
    });

    const now = new Date();
    const paidAt = saleStatus === 'PAID' ? now : null;
    const lotGroups = groupStaffSeatsByLot(publicSeats);
    if (lotGroups.size === 0) {
      throw new EventsError('LOTE_NAO_ENCONTRADO', 'Assentos selecionados não estão vinculados a lotes.', 409);
    }

    const createdSaleIds: string[] = [];

    for (const [lotId, groupSeats] of lotGroups) {
      await tx.$queryRaw`SELECT id FROM "EventTicketLot" WHERE id = ${lotId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;

      const lot = await tx.eventTicketLot.findFirst({
        where: { id: lotId, contaId: ctx.contaId, eventId: input.eventId },
        include: { event: true },
      });
      if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote vinculado ao assento não encontrado.', 404);
      if (lot.status !== 'ACTIVE') throw new EventsError('LOTE_INATIVO', 'Lote inativo para um dos assentos selecionados.', 409);

      const lotTotal = groupSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
      const unitPrice = groupSeats.length > 0 ? lotTotal / groupSeats.length : 0;
      const totalAmount = saleStatus === 'COMPLIMENTARY' ? 0 : lotTotal;

      const sale = await tx.eventTicketSale.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          lotId,
          buyerName: input.buyerName,
          alunoId: input.alunoId,
          responsavelId: input.responsavelId,
          quantity: groupSeats.length,
          unitPriceSnapshot: decimal(unitPrice),
          totalAmount: decimal(totalAmount),
          paymentMethod: input.paymentMethod,
          status: saleStatus,
          soldAt: input.soldAt ?? now,
          paidAt,
          createdByUserId: ctx.userId,
          notes: input.notes,
        },
      });
      createdSaleIds.push(sale.id);

      if (saleStatus !== 'COMPLIMENTARY' && totalAmount > 0) {
        const entry = await tx.eventFinancialEntry.create({
          data: {
            contaId: ctx.contaId,
            eventId: input.eventId,
            type: 'REVENUE',
            category: 'Venda de ingresso',
            description: `Venda manual de ingresso - ${lot.name}`,
            originType: 'TICKET_SALE',
            originId: sale.id,
            expectedAmount: decimal(totalAmount),
            actualAmount: saleStatus === 'PAID' ? decimal(totalAmount) : null,
            status: saleStatus === 'PAID' ? 'RECEIVED' : 'PENDING',
            paymentMethod: input.paymentMethod,
            realizedAt: saleStatus === 'PAID' ? now : null,
            createdByUserId: ctx.userId,
          },
        });
        await tx.eventTicketSale.update({ where: { id: sale.id }, data: { revenueEntryId: entry.id } });
      }

      for (const seat of groupSeats) {
        const soldUpdate = await tx.eventMapPublicSeat.updateMany({
          where: { contaId: ctx.contaId, id: seat.id, status: 'HELD' },
          data: { status: 'SOLD' },
        });
        if (soldUpdate.count !== 1) {
          throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Não foi possível confirmar um dos assentos.', 409);
        }

        const saleSeat = await tx.eventTicketSaleSeat.create({
          data: {
            contaId: ctx.contaId,
            saleId: sale.id,
            publicSeatId: seat.id,
            unitPriceSnapshot: decimal(toMoney(seat.unitPrice)),
            sectionName: seat.sectionName,
            seatLabel: seat.displayLabel,
            technicalCode: seat.technicalCode,
          },
        });

        await tx.eventTicket.create({
          data: {
            contaId: ctx.contaId,
            eventId: input.eventId,
            eventTicketSaleId: sale.id,
            saleSeatId: saleSeat.id,
            ticketCode: createPublicToken('ticket').toUpperCase(),
          },
        });
      }

      const sold = await tx.eventTicketSale.aggregate({
        where: { contaId: ctx.contaId, lotId, status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] } },
        _sum: { quantity: true },
      });
      const quantitySold = sold._sum.quantity ?? 0;
      const nextStatus = quantitySold >= lot.quantityTotal ? 'SOLD_OUT' : 'ACTIVE';
      await tx.eventTicketLot.update({
        where: { id: lotId },
        data: { quantitySold, status: nextStatus },
      });
    }

    await tx.eventMapReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: now, checkoutKey: null },
    });

    return { saleIds: createdSaleIds, primarySaleId: createdSaleIds[0]! };
  });
}

function compareSeatLabels(left: string, right: string) {
  return left.localeCompare(right, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export async function getStaffSaleTicketsForAdmin(contaId: string, saleId: string) {
  const sale = await prisma.eventTicketSale.findFirst({
    where: { id: saleId, contaId },
    include: {
      saleSeats: {
        include: {
          ticket: { select: { id: true, ticketCode: true, status: true } },
        },
      },
      event: { select: { id: true, name: true, startsAt: true, locationName: true, locationAddress: true } },
    },
  });
  if (!sale || sale.saleSeats.length === 0) {
    throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda com ingressos numerados não encontrada.', 404);
  }

  if (!canPrintStaffSaleTickets(sale.status)) {
    throw new EventsError(
      'INGRESSOS_INDISPONIVEIS',
      'Ingressos não estão disponíveis para esta venda.',
      409,
    );
  }

  const saleSeats = [...sale.saleSeats].sort((left, right) => {
    const sectionCompare = left.sectionName.localeCompare(right.sectionName, 'pt-BR', { sensitivity: 'base' });
    if (sectionCompare !== 0) return sectionCompare;
    return compareSeatLabels(left.seatLabel, right.seatLabel);
  });

  const printableSeats = saleSeats.filter(
    (seat) => seat.ticket?.ticketCode && seat.ticket.status === 'VALID',
  );
  if (printableSeats.length === 0) {
    throw new EventsError('INGRESSOS_NAO_ENCONTRADOS', 'Nenhum ingresso válido encontrado para esta venda.', 404);
  }

  return {
    id: sale.id,
    buyerName: sale.buyerName,
    totalAmount: toMoney(sale.totalAmount),
    event: {
      ...sale.event,
      startsAt: sale.event.startsAt.toISOString(),
    },
    items: printableSeats.map((seat) => ({
      id: seat.id,
      sectionName: seat.sectionName,
      seatLabel: seat.seatLabel,
      technicalCode: seat.technicalCode,
      unitPrice: toMoney(seat.unitPriceSnapshot),
      ticketCode: seat.ticket!.ticketCode,
      ticketStatus: seat.ticket?.status ?? 'VALID',
    })),
  };
}
