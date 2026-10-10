import { Prisma, PrismaClient, type EventMapPublicSeatStatus } from '@prisma/client';

import {
  canCreateEventMap,
  canEditEventMapDraft,
  countTicketLotCapacitiesFromMap,
  decideEventMapDeletion,
  isPublicEventMapVisible,
  MAX_EVENT_MAPS_PER_EVENT,
  sortEventMapsForDisplay,
  validatePublicSeatSelection,
  validateEventMapStatusTransition,
  validatePublishableEventMap,
} from '@alusa/domain/events';
import { migrateLegacyMapDocument, normalizeMapReferenceChart, resolveEventMapLayout, sectionLocalToWorld } from '@alusa/domain';
import type { EventMapDocument, MapReferenceChart, MapSeatBlock, MapSeatRow } from '@alusa/domain';

import { prisma } from '../../prisma';
import { assertEventTicketSalesOpen, EventsError, type EventsContext } from '../events.service';
import { enqueueEventTicketEmail } from '../ticket-email-outbox';
import { createCheckInCode, toCheckInCode } from './ticket-code';
import {
  isTicketPaymentBlocked,
  markEventTicketUsed,
  verifyEventTicketForCheckIn,
} from '../ticket-checkin.service';
import { getPublicReservationExpiration } from './public-reservation-policy';
import { publicOrderStatusPath, publicOrderTicketsPath } from './public-order-links';
import {
  decimal,
  toAuditJson,
  toMoney,
} from './event-map-order-operations';
export { cancelPublicEventMapOrder, lockPublicEventMapReservation } from './event-map-order-operations';
import type {
  CreateEventMapInput,
  DuplicateEventMapInput,
  PublicCheckoutInput,
  PublicSeatReservationInput,
  UpdateEventMapDraftInput,
  UpdateEventMapReferenceChartInput,
  UpdateEventMapSettingsInput,
} from './event-map.schema';

export type { PublicCheckoutInput } from './event-map.schema';

type DbClient = PrismaClient | Prisma.TransactionClient;

const eventMapInclude = {
  event: {
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      locationName: true,
      locationAddress: true,
      status: true,
      ticketMode: true,
    },
  },
  levels: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  sections: {
    include: {
      lot: { select: { id: true, name: true, unitPrice: true, status: true, quantityTotal: true, quantitySold: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }],
  },
  objects: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  seats: { orderBy: [{ technicalCode: 'asc' as const }] },
  versions: {
    select: { id: true, version: true, status: true, seatCount: true, publishedAt: true, createdAt: true },
    orderBy: { version: 'desc' as const },
  },
} satisfies Prisma.EventMapInclude;

type EventMapRecord = Prisma.EventMapGetPayload<{ include: typeof eventMapInclude }>;

const eventMapListInclude = {
  ...eventMapInclude,
  _count: { select: { orders: true } },
} satisfies Prisma.EventMapInclude;

type EventMapListRecord = Prisma.EventMapGetPayload<{ include: typeof eventMapListInclude }>;

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function assertOwnedReferenceChart(referenceChart: MapReferenceChart, contaId: string, mapId: string) {
  const storageKey = referenceChart.storageKey;
  const expectedPrefix = `uploads/event-maps/${contaId}/${mapId}/reference-`;
  const isOwnedKey = Boolean(
    storageKey &&
      storageKey.startsWith(expectedPrefix) &&
      /^uploads\/event-maps\/[^/]+\/[^/]+\/reference-[^/]+\.(jpg|jpeg|png|webp)$/i.test(storageKey),
  );
  if (!isOwnedKey) {
    throw new EventsError(
      'PLANTA_REFERENCIA_INVALIDA',
      'A planta de referência não pertence a este mapa.',
      400,
    );
  }
}

function createLocalId(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function normalizeDocument(document: string | null | undefined) {
  return document?.replace(/\D/g, '') ?? '';
}

function publicMapPath(publicSlug: string | null | undefined) {
  return publicSlug ? `/m/${publicSlug}` : null;
}

export { publicOrderStatusPath } from './public-order-links';

function readDraftDocument(record: EventMapRecord | EventMapListRecord): EventMapDocument {
  const candidate = record.draftDocument;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const value = candidate as Partial<EventMapDocument>;
    if (value.schemaVersion === 1 && Array.isArray(value.sections) && Array.isArray(value.visualElements)) {
      return value as EventMapDocument;
    }
  }

  return migrateLegacyMapDocument({
    sections: record.sections.map((section) => ({
      id: section.id,
      levelId: section.levelId,
      name: section.name,
      color: section.color,
      lotId: section.lotId,
      capacity: section.capacity,
      status: section.status,
      notes: section.notes,
    })),
    groups: [],
    seats: record.seats.map((seat) => ({
      id: seat.id,
      sectionId: seat.sectionId,
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
      technicalCode: seat.technicalCode,
      displayLabel: seat.displayLabel,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      accessible: seat.accessible,
      publicVisible: seat.publicVisible,
    })),
    visualElements: record.objects.map((object) => ({
      id: object.id,
      levelId: object.levelId,
      sectionId: object.sectionId,
      type: object.type,
      data: (object.data ?? {}) as Record<string, unknown>,
      x: toNumber(object.x),
      y: toNumber(object.y),
      width: object.width == null ? null : toNumber(object.width),
      height: object.height == null ? null : toNumber(object.height),
      rotation: toNumber(object.rotation),
      locked: object.locked,
      hidden: object.hidden,
      sortOrder: object.sortOrder,
    })),
  });
}

function remapDraftDocument(
  document: EventMapDocument | undefined,
  maps: {
    levelIds: Map<string, string>;
    sectionIds: Map<string, string>;
    objectIds: Map<string, string>;
    blockIds: Map<string, string>;
    rowIds: Map<string, string>;
    seatIds: Map<string, string>;
  },
): EventMapDocument | undefined {
  if (!document) return undefined;
  const remapRow = (row: MapSeatRow, blockId: string, sectionId: string): MapSeatRow => ({
    ...row,
    id: maps.rowIds.get(row.id) ?? row.id,
    sectionId,
    blockId,
    seatIds: row.seatIds.map((id) => maps.seatIds.get(id) ?? id),
    seats: row.seats.map((seat) => ({ ...seat, id: maps.seatIds.get(seat.id) ?? seat.id })),
  });
  const remapBlock = (block: MapSeatBlock, sectionId: string): MapSeatBlock => ({
    ...block,
    id: maps.blockIds.get(block.id) ?? block.id,
    sectionId,
    rowIds: block.rowIds.map((id) => maps.rowIds.get(id) ?? id),
    rows: block.rows.map((row) => remapRow(row, maps.blockIds.get(block.id) ?? block.id, sectionId)),
  });

  return {
    ...document,
    sections: document.sections.map((section) => {
      const sectionId = maps.sectionIds.get(section.id) ?? section.id;
      return {
        ...section,
        id: sectionId,
        levelId: maps.levelIds.get(section.levelId) ?? section.levelId,
        blockIds: section.blockIds.map((id) => maps.blockIds.get(id) ?? id),
        blocks: section.blocks.map((block) => remapBlock(block, sectionId)),
      };
    }),
    visualElements: document.visualElements.map((element) => ({
      ...element,
      id: maps.objectIds.get(element.id) ?? element.id,
      levelId: maps.levelIds.get(element.levelId) ?? element.levelId,
      sectionId: element.sectionId ? maps.sectionIds.get(element.sectionId) ?? element.sectionId : null,
    })),
  };
}

function toPublicSeatStatus(status: string): EventMapPublicSeatStatus {
  if (status === 'SOLD') return 'SOLD';
  if (status === 'HELD') return 'HELD';
  if (status === 'BLOCKED') return 'BLOCKED';
  if (status === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (status === 'COMPLIMENTARY') return 'UNAVAILABLE';
  return 'AVAILABLE';
}

async function recordMapAudit(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    actorUserId: string;
    action: string;
    entityId: string;
    eventId: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
) {
  await tx.eventAudit.create({
    data: {
      contaId: params.contaId,
      eventId: params.eventId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: 'EventMap',
      entityId: params.entityId,
      before: params.before === undefined ? undefined : toAuditJson(params.before),
      after: params.after === undefined ? undefined : toAuditJson(params.after),
      metadata: params.metadata === undefined ? undefined : toAuditJson(params.metadata),
    },
  });

  await tx.auditLog.create({
    data: {
      contaId: params.contaId,
      actorType: 'USER',
      actorId: params.actorUserId,
      action: params.action,
      entityType: 'EventMap',
      entityId: params.entityId,
      metadata: params.metadata === undefined ? undefined : toAuditJson(params.metadata),
    },
  });
}

async function getEventForMapOrThrow(db: DbClient, contaId: string, eventId: string) {
  const event = await db.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: {
      id: true,
      contaId: true,
      name: true,
      startsAt: true,
      endsAt: true,
      locationName: true,
      locationAddress: true,
      status: true,
      ticketMode: true,
      hasTickets: true,
    },
  });

  if (!event) {
    throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  }

  return event;
}

function assertMapEditable(map: { status: string }) {
  if (!canEditEventMapDraft(map.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED')) {
    throw new EventsError('MAPA_ARQUIVADO', 'Mapa arquivado não pode ser editado.', 409);
  }
}

function assertNumberedSeatEvent(event: { ticketMode: string }) {
  if (event.ticketMode !== 'NUMBERED_SEATS') {
    throw new EventsError(
      'EVENTO_SEM_ASSENTOS_NUMERADOS',
      'Configure o tipo de ingresso do evento como Assentos numerados antes de criar um mapa.',
      409,
    );
  }
}

async function getMapRecordOrThrow(db: DbClient, contaId: string, eventId: string, mapId: string) {
  const map = await db.eventMap.findFirst({
    where: { id: mapId, contaId, eventId },
    include: eventMapInclude,
  });

  if (!map) {
    throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
  }

  return map;
}

function mapEventMap(record: EventMapRecord | EventMapListRecord) {
  return {
    id: record.id,
    contaId: record.contaId,
    eventId: record.eventId,
    event: {
      ...record.event,
      startsAt: record.event.startsAt.toISOString(),
      endsAt: record.event.endsAt?.toISOString() ?? null,
    },
    name: record.name,
    startsAt: (record.startsAt ?? record.event.startsAt).toISOString(),
    endsAt: record.endsAt?.toISOString() ?? null,
    locationName: record.locationName ?? record.event.locationName,
    locationAddress: record.locationAddress ?? record.event.locationAddress,
    status: record.status,
    publishedVersionId: record.publishedVersionId,
    publicSlug: record.publicSlug,
    publicEnabled: record.publicEnabled,
    publicUrl: publicMapPath(record.publicSlug),
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    publishedAt: record.publishedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    document: readDraftDocument(record),
    referenceChart: normalizeMapReferenceChart(record.referenceChart),
    levels: record.levels.map((level) => ({
      id: level.id,
      name: level.name,
      sortOrder: level.sortOrder,
      widthPx: level.widthPx,
      heightPx: level.heightPx,
      unit: level.unit,
      scale: level.scale,
    })),
    sections: record.sections.map((section) => ({
      id: section.id,
      levelId: section.levelId,
      lotId: section.lotId,
      lot: section.lot
        ? {
            id: section.lot.id,
            name: section.lot.name,
            unitPrice: toMoney(section.lot.unitPrice),
            status: section.lot.status,
            quantityTotal: section.lot.quantityTotal,
            quantitySold: section.lot.quantitySold,
          }
        : null,
      name: section.name,
      color: section.color,
      capacity: section.capacity,
      status: section.status,
      notes: section.notes,
    })),
    objects: record.objects.map((object) => ({
      id: object.id,
      levelId: object.levelId,
      sectionId: object.sectionId,
      type: object.type,
      data: (object.data ?? {}) as Record<string, unknown>,
      x: toNumber(object.x),
      y: toNumber(object.y),
      width: object.width == null ? null : toNumber(object.width),
      height: object.height == null ? null : toNumber(object.height),
      rotation: toNumber(object.rotation),
      locked: object.locked,
      hidden: object.hidden,
      sortOrder: object.sortOrder,
    })),
    seats: record.seats.map((seat) => ({
      id: seat.id,
      levelId: seat.levelId,
      sectionId: seat.sectionId,
      objectId: seat.objectId,
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
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
    })),
    versions: record.versions.map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      seatCount: version.seatCount,
      publishedAt: version.publishedAt.toISOString(),
      createdAt: version.createdAt.toISOString(),
    })),
    counts: {
      levels: record.levels.length,
      sections: record.sections.length,
      seats: record.seats.length,
      availableSeats: record.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
      orders: '_count' in record && record._count ? record._count.orders : 0,
    },
  };
}

export type EventMapDTO = ReturnType<typeof mapEventMap>;

function operationalEventMapsWhere(contaId: string, eventId: string): Prisma.EventMapWhereInput {
  return { contaId, eventId, status: { not: 'ARCHIVED' } };
}

export async function listEventMaps(ctx: Pick<EventsContext, 'contaId'>, eventId: string) {
  await getEventForMapOrThrow(prisma, ctx.contaId, eventId);
  const maps = await prisma.eventMap.findMany({
    where: operationalEventMapsWhere(ctx.contaId, eventId),
    include: eventMapListInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });

  return sortEventMapsForDisplay(maps.map(mapEventMap));
}

export async function getEventMap(ctx: Pick<EventsContext, 'contaId'>, eventId: string, mapId: string) {
  return mapEventMap(await getMapRecordOrThrow(prisma, ctx.contaId, eventId, mapId));
}

export async function createEventMap(ctx: EventsContext, eventId: string, input: CreateEventMapInput) {
  return prisma.$transaction(async (tx) => {
    const event = await getEventForMapOrThrow(tx, ctx.contaId, eventId);
    assertNumberedSeatEvent(event);

    const startsAt = input.startsAt ?? event.startsAt;
    const endsAt = input.endsAt === undefined ? event.endsAt : input.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new EventsError('HORARIO_SESSAO_INVALIDO', 'O término da sessão deve ser posterior ao início.', 422);
    }

    // Serialize map creation on the parent event so concurrent requests cannot
    // both pass the per-event map limit using the same count snapshot.
    const lockedEvent = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SchoolEvent"
      WHERE "id" = ${eventId} AND "contaId" = ${ctx.contaId}
      FOR UPDATE
    `);
    if (lockedEvent.length === 0) {
      throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    }

    const mapCount = await tx.eventMap.count({ where: operationalEventMapsWhere(ctx.contaId, eventId) });
    if (!canCreateEventMap(mapCount)) {
      throw new EventsError(
        'LIMITE_MAPAS_EVENTO',
        `Cada evento pode ter no máximo ${MAX_EVENT_MAPS_PER_EVENT} mapas.`,
        409,
      );
    }

    const created = await tx.eventMap.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        name: input.name,
        startsAt,
        endsAt,
        locationName: input.locationName === undefined ? event.locationName : input.locationName,
        locationAddress: input.locationAddress === undefined ? event.locationAddress : input.locationAddress,
        status: 'DRAFT',
        createdByUserId: ctx.userId,
        levels: {
          create: {
            contaId: ctx.contaId,
            name: 'Ambiente 1',
            sortOrder: 0,
            widthPx: 1440,
            heightPx: 900,
            unit: 'px',
            scale: null,
          },
        },
      },
    });

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.create',
      entityId: created.id,
      eventId,
      after: created,
      metadata: {
        source: input.templateMapId ? 'template' : input.creationMode === 'reference-plan' ? 'reference-plan' : 'blank',
      },
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, created.id));
  });
}

function validateDraftReferences(input: UpdateEventMapDraftInput) {
  const assertUniqueIds = (items: Array<{ id: string }>, label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) {
        throw new EventsError('MAPA_REFERENCIA_INVALIDA', `O identificador de ${label} ${item.id} está duplicado.`, 422);
      }
      ids.add(item.id);
    }
  };

  assertUniqueIds(input.levels, 'prancheta');
  assertUniqueIds(input.sections, 'setor');
  assertUniqueIds(input.objects, 'objeto');
  assertUniqueIds(input.seats, 'assento');

  const levelIds = new Set(input.levels.map((level) => level.id));
  const sectionIds = new Set(input.sections.map((section) => section.id));
  const objectIds = new Set(input.objects.map((object) => object.id));
  const technicalCodes = new Set<string>();

  for (const section of input.sections) {
    if (!levelIds.has(section.levelId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', `Setor "${section.name}" aponta para uma prancheta inexistente.`, 422);
    }
  }

  for (const object of input.objects) {
    if (!levelIds.has(object.levelId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', 'Há um objeto apontando para uma prancheta inexistente.', 422);
    }
    if (object.sectionId && !sectionIds.has(object.sectionId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', 'Há um objeto apontando para um setor inexistente.', 422);
    }
  }

  for (const seat of input.seats) {
    if (!levelIds.has(seat.levelId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', `Assento ${seat.displayLabel} aponta para uma prancheta inexistente.`, 422);
    }
    if (!sectionIds.has(seat.sectionId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', `Assento ${seat.displayLabel} precisa pertencer a um setor válido.`, 422);
    }
    if (seat.objectId && !objectIds.has(seat.objectId)) {
      throw new EventsError('MAPA_REFERENCIA_INVALIDA', `Assento ${seat.displayLabel} aponta para um objeto inexistente.`, 422);
    }
    if (technicalCodes.has(seat.technicalCode)) {
      throw new EventsError('CODIGO_ASSENTO_DUPLICADO', `O código técnico ${seat.technicalCode} está duplicado.`, 422);
    }
    technicalCodes.add(seat.technicalCode);
  }
}

function materializeDocumentDraft(
  input: UpdateEventMapDraftInput,
  previousSeats: ReadonlyArray<Pick<UpdateEventMapDraftInput['seats'][number], 'id' | 'status' | 'publicVisible' | 'accessible'>> = [],
): UpdateEventMapDraftInput {
  if (!input.document) return input;
  const layout = resolveEventMapLayout(input.document);
  const blocking = layout.diagnostics.filter((diagnostic) =>
    ['INVALID_SECTION', 'INVALID_ROW_PATH', 'INVALID_DISTRIBUTION', 'INVALID_SPACING', 'ROW_OUTSIDE_SECTION', 'SEAT_OUTSIDE_SECTION', 'SEAT_OVERLAP'].includes(diagnostic.type),
  );
  if (blocking.length > 0) {
    throw new EventsError('MAPA_LAYOUT_INVALIDO', blocking.map((diagnostic) => diagnostic.message).join(' '), 422);
  }

  const sectionById = new Map(input.document.sections.map((section) => [section.id, section]));
  const inputSeatById = new Map(input.seats.map((seat) => [seat.id, seat]));
  const previousSeatById = new Map(previousSeats.map((seat) => [seat.id, seat]));
  return {
    ...input,
    sections: input.document.sections.map((section) => ({
      id: section.id,
      levelId: section.levelId,
      lotId: section.lotId ?? null,
      name: section.name,
      color: section.color,
      capacity: section.capacity ?? null,
      status: section.status ?? 'ACTIVE',
      notes: section.notes ?? null,
    })),
    objects: input.document.visualElements.map((element) => ({
      id: element.id,
      levelId: element.levelId,
      sectionId: element.sectionId ?? null,
      type: element.type as UpdateEventMapDraftInput['objects'][number]['type'],
      data: element.data,
      x: element.x,
      y: element.y,
      width: element.width ?? null,
      height: element.height ?? null,
      rotation: element.rotation,
      locked: element.locked,
      hidden: element.hidden,
      sortOrder: element.sortOrder,
    })),
    seats: layout.seats.map((seat) => {
      const section = sectionById.get(seat.sectionId)!;
      const world = sectionLocalToWorld({ x: seat.x, y: seat.y }, section.position, section.rotation);
      return {
        id: seat.seatId,
        levelId: seat.levelId,
        sectionId: seat.sectionId,
        objectId: null,
        rowIndex: seat.rowIndex,
        columnIndex: seat.columnIndex,
        technicalCode: seat.technicalCode,
        displayLabel: seat.label,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        status: inputSeatById.get(seat.seatId)?.status ?? previousSeatById.get(seat.seatId)?.status ?? ('AVAILABLE' as const),
        accessible: inputSeatById.get(seat.seatId)?.accessible ?? seat.accessible ?? previousSeatById.get(seat.seatId)?.accessible ?? false,
        publicVisible: inputSeatById.get(seat.seatId)?.publicVisible ?? seat.publicVisible ?? previousSeatById.get(seat.seatId)?.publicVisible ?? true,
        x: world.x,
        y: world.y,
        size: seat.size,
        rotation: seat.rotation + section.rotation,
      };
    }),
  };
}

async function syncNumberedSeatLotCapacities(
  tx: Prisma.TransactionClient,
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  mapId: string,
  input: {
    sections: Array<{ id: string; lotId?: string | null }>;
    seats: Array<{ sectionId: string; publicVisible?: boolean }>;
  },
) {
  const event = await tx.schoolEvent.findFirst({
    where: { id: eventId, contaId: ctx.contaId },
    select: { ticketMode: true },
  });
  if (event?.ticketMode !== 'NUMBERED_SEATS') return;

  const capacityByLotId = countTicketLotCapacitiesFromMap(input);
  const lotIds = [...capacityByLotId.keys()];
  if (lotIds.length === 0) return;
  const lots = await tx.eventTicketLot.findMany({
    where: {
      contaId: ctx.contaId,
      eventId,
      id: { in: lotIds },
      OR: [
        { eventMapId: mapId },
        // Without a production backfill, resolve legacy ownership through the
        // map's existing section references when synchronizing seat capacity.
        { eventMapId: null, mapSections: { some: { contaId: ctx.contaId, eventMapId: mapId } } },
      ],
      mapSections: { none: { contaId: ctx.contaId, eventMapId: { not: mapId } } },
    },
    select: { id: true, quantitySold: true, status: true },
  });

  for (const lot of lots) {
    const seatCapacity = capacityByLotId.get(lot.id) ?? 0;
    const quantityTotal = Math.max(seatCapacity, lot.quantitySold);
    const nextStatus =
      lot.status === 'ACTIVE' && lot.quantitySold >= quantityTotal && quantityTotal > 0
        ? 'SOLD_OUT'
        : lot.status === 'SOLD_OUT' && lot.quantitySold < quantityTotal
          ? 'ACTIVE'
          : lot.status;

    await tx.eventTicketLot.update({
      where: { id: lot.id },
      data: { quantityTotal, status: nextStatus },
    });
  }
}

async function assertLotsBelongToEvent(
  tx: Prisma.TransactionClient,
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  mapId: string,
  input: UpdateEventMapDraftInput,
) {
  const lotIds = [...new Set(input.sections.map((section) => section.lotId).filter(Boolean))] as string[];
  if (lotIds.length === 0) return;

  const lots = await tx.eventTicketLot.findMany({
    where: { contaId: ctx.contaId, eventId, id: { in: lotIds } },
    select: { id: true, eventMapId: true },
  });
  const found = new Set(lots.filter((lot) => lot.eventMapId === mapId).map((lot) => lot.id));
  const missing = lotIds.filter((lotId) => !found.has(lotId));

  if (missing.length > 0) {
    throw new EventsError('LOTE_INVALIDO', 'Um ou mais setores apontam para lotes de outro evento ou conta.', 422);
  }
}

async function ensureMapOwnedLots(
  tx: Prisma.TransactionClient,
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  mapId: string,
  input: UpdateEventMapDraftInput,
): Promise<UpdateEventMapDraftInput> {
  const lotIds = [...new Set(input.sections.map((section) => section.lotId).filter(Boolean))] as string[];
  if (lotIds.length === 0) return input;

  // Lock lots in a stable order before deciding whether to claim or clone them.
  // Without this, two map drafts can both observe an unowned lot and attach it
  // to different maps, coupling their capacity and sales.
  const lockedLots = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "EventTicketLot"
    WHERE "contaId" = ${ctx.contaId}
      AND "eventId" = ${eventId}
      AND "id" IN (${Prisma.join(lotIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  if (lockedLots.length !== lotIds.length) {
    throw new EventsError('LOTE_INVALIDO', 'Um ou mais setores apontam para lotes de outro evento ou conta.', 422);
  }

  const lots = await tx.eventTicketLot.findMany({
    where: { contaId: ctx.contaId, eventId, id: { in: lotIds } },
    orderBy: { id: 'asc' },
  });
  if (lots.length !== lotIds.length) {
    throw new EventsError('LOTE_INVALIDO', 'Um ou mais setores apontam para lotes de outro evento ou conta.', 422);
  }

  const lotIdMap = new Map<string, string>();
  for (const lot of lots) {
    if (lot.eventMapId === mapId) continue;
    const usedByOtherMap = await tx.eventMapSection.findFirst({
      where: { contaId: ctx.contaId, lotId: lot.id, eventMapId: { not: mapId } },
      select: { id: true },
    });
    if (!lot.eventMapId && !usedByOtherMap) {
      const claimed = await tx.eventTicketLot.updateMany({
        where: { id: lot.id, contaId: ctx.contaId, eventId, eventMapId: null },
        data: { eventMapId: mapId },
      });
      if (claimed.count !== 1) {
        throw new EventsError('LOTE_CONCORRENTE', 'O lote foi alterado por outra operação. Atualize o mapa e tente novamente.', 409);
      }
      lotIdMap.set(lot.id, lot.id);
      continue;
    }

    const cloned = await tx.eventTicketLot.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        eventMapId: mapId,
        name: lot.name,
        ticketType: lot.ticketType,
        unitPrice: lot.unitPrice,
        quantityTotal: lot.quantityTotal,
        quantitySold: 0,
        saleStartsAt: lot.saleStartsAt,
        saleEndsAt: lot.saleEndsAt,
        status: lot.status === 'SOLD_OUT' && lot.quantityTotal > 0 ? 'ACTIVE' : lot.status,
        notes: lot.notes,
      },
    });
    lotIdMap.set(lot.id, cloned.id);
  }

  const sections = input.sections.map((section) => ({
    ...section,
    lotId: section.lotId ? lotIdMap.get(section.lotId) ?? section.lotId : section.lotId,
  }));
  const document = input.document
    ? {
        ...input.document,
        sections: input.document.sections.map((section) => ({
          ...section,
          lotId: section.lotId ? lotIdMap.get(section.lotId) ?? section.lotId : section.lotId,
        })),
      }
    : undefined;
  return { ...input, sections, ...(document ? { document } : {}) };
}

export async function updateEventMapDraft(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: UpdateEventMapDraftInput,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "EventMap"
      WHERE "id" = ${mapId} AND "contaId" = ${ctx.contaId} AND "eventId" = ${eventId}
      FOR UPDATE
    `);
    if (locked.length === 0) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    const current = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);
    if (current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw new EventsError('CONFLITO_RASCUNHO_MAPA', 'Este mapa foi alterado por outra pessoa. Recarregue o mapa antes de salvar suas alterações.', 409);
    }
    const previousSeats = await tx.eventSeat.findMany({
      where: { contaId: ctx.contaId, eventMapId: mapId },
      select: { id: true, status: true, publicVisible: true, accessible: true },
    });
    const materializedInput = materializeDocumentDraft(input, previousSeats);
    validateDraftReferences(materializedInput);
    const mapOwnedInput = await ensureMapOwnedLots(tx, ctx, eventId, mapId, materializedInput);
    await assertLotsBelongToEvent(tx, ctx, eventId, mapId, mapOwnedInput);

    await tx.eventSeat.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapObject.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapSection.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapLevel.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });

    await tx.eventMap.update({
      where: { id: mapId },
      data: {
        name: mapOwnedInput.name ?? current.name,
        ...(mapOwnedInput.document ? { draftDocument: toInputJson(mapOwnedInput.document) } : {}),
      },
    });

    await tx.eventMapLevel.createMany({
      data: mapOwnedInput.levels.map((level) => ({
        id: level.id,
        contaId: ctx.contaId,
        eventMapId: mapId,
        name: level.name,
        sortOrder: level.sortOrder,
        widthPx: level.widthPx,
        heightPx: level.heightPx,
        unit: level.unit,
        scale: level.scale,
      })),
    });

    if (mapOwnedInput.sections.length > 0) {
      await tx.eventMapSection.createMany({
        data: mapOwnedInput.sections.map((section) => ({
          id: section.id,
          contaId: ctx.contaId,
          eventMapId: mapId,
          levelId: section.levelId,
          lotId: section.lotId,
          name: section.name,
          color: section.color,
          capacity: section.capacity,
          status: section.status,
          notes: section.notes,
        })),
      });
    }

    if (mapOwnedInput.objects.length > 0) {
      await tx.eventMapObject.createMany({
        data: mapOwnedInput.objects.map((object) => ({
          id: object.id,
          contaId: ctx.contaId,
          eventMapId: mapId,
          levelId: object.levelId,
          sectionId: object.sectionId,
          type: object.type,
          data: toInputJson(object.data),
          x: decimal(object.x),
          y: decimal(object.y),
          width: object.width == null ? null : decimal(object.width),
          height: object.height == null ? null : decimal(object.height),
          rotation: decimal(object.rotation),
          locked: object.locked,
          hidden: object.hidden,
          sortOrder: object.sortOrder,
        })),
      });
    }

    if (mapOwnedInput.seats.length > 0) {
      await tx.eventSeat.createMany({
        data: mapOwnedInput.seats.map((seat) => ({
          id: seat.id,
          contaId: ctx.contaId,
          eventMapId: mapId,
          levelId: seat.levelId,
          sectionId: seat.sectionId,
          objectId: seat.objectId,
          rowIndex: seat.rowIndex,
          columnIndex: seat.columnIndex,
          technicalCode: seat.technicalCode,
          displayLabel: seat.displayLabel,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          status: seat.status,
          accessible: seat.accessible,
          publicVisible: seat.publicVisible,
          x: decimal(seat.x),
          y: decimal(seat.y),
          size: seat.size == null ? null : decimal(seat.size),
          rotation: decimal(seat.rotation),
        })),
      });
    }

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.draft.update',
      entityId: mapId,
      eventId,
      before: current,
      metadata: {
        levels: mapOwnedInput.levels.length,
        sections: mapOwnedInput.sections.length,
        objects: mapOwnedInput.objects.length,
        seats: mapOwnedInput.seats.length,
      },
    });

    await syncNumberedSeatLotCapacities(tx, ctx, eventId, mapId, {
      sections: mapOwnedInput.sections,
      seats: mapOwnedInput.seats,
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId));
  });
}

export async function updateEventMapSettings(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: UpdateEventMapSettingsInput,
) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.eventMap.findFirst({
      where: { id: mapId, contaId: ctx.contaId, eventId },
      include: { event: { select: { startsAt: true, endsAt: true } } },
    });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);

    const nextStartsAt = input.startsAt === undefined ? current.startsAt ?? current.event.startsAt : input.startsAt;
    const nextEndsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    if (nextStartsAt && nextEndsAt && nextEndsAt <= nextStartsAt) {
      throw new EventsError('HORARIO_SESSAO_INVALIDO', 'O término da sessão deve ser posterior ao início.', 422);
    }

    if (input.publicEnabled !== undefined && current.status !== 'PUBLISHED') {
      throw new EventsError(
        'MAPA_NAO_PUBLICADO',
        'Somente mapas publicados podem ter a venda pública ativada ou pausada.',
        422,
      );
    }

    await tx.eventMap.update({
      where: { id: mapId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.locationName !== undefined ? { locationName: input.locationName } : {}),
        ...(input.locationAddress !== undefined ? { locationAddress: input.locationAddress } : {}),
        ...(input.publicEnabled !== undefined ? { publicEnabled: input.publicEnabled } : {}),
      },
    });

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.settings.update',
      entityId: mapId,
      eventId,
      before: current,
      after: {
        name: input.name ?? current.name,
        startsAt: input.startsAt ?? current.startsAt,
        endsAt: input.endsAt ?? current.endsAt,
        locationName: input.locationName ?? current.locationName,
        locationAddress: input.locationAddress ?? current.locationAddress,
        publicEnabled: input.publicEnabled ?? current.publicEnabled,
      },
    });
  });

  return getEventMap(ctx, eventId, mapId);
}

export async function updateEventMapReferenceChart(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: UpdateEventMapReferenceChartInput,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);

    const referenceChart = input.referenceChart as MapReferenceChart | null;
    if (referenceChart) assertOwnedReferenceChart(referenceChart, ctx.contaId, mapId);
    await tx.eventMap.update({
      where: { id: mapId },
      data: { referenceChart: referenceChart ? toInputJson(referenceChart) : Prisma.DbNull },
    });
    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.reference-chart.update',
      entityId: mapId,
      eventId,
      before: { referenceChart: current.referenceChart },
      after: { referenceChart },
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId));
  });
}

export async function publishEventMap(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  expectedUpdatedAt: string,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "EventMap"
      WHERE "id" = ${mapId} AND "contaId" = ${ctx.contaId} AND "eventId" = ${eventId}
      FOR UPDATE
    `);
    if (locked.length === 0) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    const map = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
    if (map.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new EventsError('CONFLITO_RASCUNHO_MAPA', 'Este mapa foi alterado por outra pessoa. Recarregue o mapa antes de publicar.', 409);
    }
    const transition = validateEventMapStatusTransition(map.status, 'PUBLISHED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const publishValidation = validatePublishableEventMap({
      ticketMode: map.event.ticketMode,
      levelsCount: map.levels.length,
      sections: map.sections.map((section) => ({ id: section.id, name: section.name, lotId: section.lotId })),
      seats: map.seats.map((seat) => ({
        id: seat.id,
        sectionId: seat.sectionId,
        status: seat.status,
        publicVisible: seat.publicVisible,
      })),
    });

    if (!publishValidation.ok) {
      throw new EventsError('MAPA_NAO_PUBLICAVEL', publishValidation.errors.join(' '), 422);
    }

    const heldReservations = await tx.eventMapReservation.count({
      where: {
        contaId: ctx.contaId,
        eventMapId: mapId,
        status: 'HELD',
      },
    });
    if (heldReservations > 0) {
      throw new EventsError(
        'MAPA_COM_RESERVAS_ATIVAS',
        'Há assentos reservados ou aguardando liberação neste mapa. Aguarde a conclusão ou a reconciliação da reserva antes de publicar uma nova versão.',
        409,
      );
    }

    const pendingOrders = await tx.eventMapOrder.count({
      where: {
        contaId: ctx.contaId,
        eventMapId: mapId,
        status: 'PAYMENT_PENDING',
      },
    });
    if (pendingOrders > 0) {
      throw new EventsError(
        'MAPA_COM_PEDIDOS_PENDENTES',
        'Há pedidos aguardando a confirmação ou reconciliação do pagamento. Resolva essas cobranças antes de publicar uma nova versão do mapa.',
        409,
      );
    }

    const nextVersion = (map.versions[0]?.version ?? 0) + 1;
    const publicSlug = map.publicSlug ?? createPublicToken('map');
    const { referenceChart: _referenceChart, ...mapSnapshot } = mapEventMap(map);
    const snapshot = { ...mapSnapshot, publicSlug, publicEnabled: true, publicUrl: publicMapPath(publicSlug) };
    const soldCodes = new Set(
      (
        await tx.eventMapPublicSeat.findMany({
          where: { contaId: ctx.contaId, eventMapId: mapId, status: 'SOLD' },
          select: { technicalCode: true },
        })
      ).map((seat) => seat.technicalCode),
    );

    const version = await tx.eventMapVersion.create({
      data: {
        contaId: ctx.contaId,
        eventMapId: mapId,
        version: nextVersion,
        status: 'PUBLISHED',
        snapshot: toInputJson(snapshot),
        seatCount: map.seats.filter((seat) => seat.publicVisible).length,
        publishedByUserId: ctx.userId,
      },
    });

    if (map.seats.length > 0) {
      const sectionsById = new Map(map.sections.map((section) => [section.id, section]));
      await tx.eventMapPublicSeat.createMany({
        data: map.seats
          .filter((seat) => seat.publicVisible)
          .map((seat) => {
            const section = sectionsById.get(seat.sectionId);
            const baseStatus = toPublicSeatStatus(seat.status);
            return {
              id: createLocalId('publicseat'),
              contaId: ctx.contaId,
              eventId,
              eventMapId: mapId,
              versionId: version.id,
              originalSeatId: seat.id,
              levelId: seat.levelId,
              sectionId: seat.sectionId,
              sectionName: section?.name ?? 'Setor',
              lotId: section?.lotId ?? null,
              lotName: section?.lot?.name ?? null,
              unitPrice: decimal(section?.lot ? toMoney(section.lot.unitPrice) : 0),
              technicalCode: seat.technicalCode,
              displayLabel: seat.displayLabel,
              rowLabel: seat.rowLabel,
              seatNumber: seat.seatNumber,
              status: soldCodes.has(seat.technicalCode) ? 'SOLD' : baseStatus,
              accessible: seat.accessible,
              publicVisible: seat.publicVisible,
              x: seat.x,
              y: seat.y,
              size: seat.size,
              rotation: seat.rotation,
              metadata: toInputJson({
                objectId: seat.objectId,
                rowIndex: seat.rowIndex,
                columnIndex: seat.columnIndex,
              }),
            };
          }),
      });
    }

    await tx.eventMap.update({
      where: { id: mapId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedVersionId: version.id,
        publicSlug,
        publicEnabled: true,
      },
    });

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.publish',
      entityId: mapId,
      eventId,
      before: { status: map.status },
      after: { status: 'PUBLISHED', version: nextVersion, publicSlug },
    });

    const publishedMap = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
    await syncNumberedSeatLotCapacities(tx, ctx, eventId, mapId, {
      sections: publishedMap.sections.map((section) => ({ id: section.id, lotId: section.lotId })),
      seats: publishedMap.seats.map((seat) => ({ sectionId: seat.sectionId, publicVisible: seat.publicVisible })),
    });

    return mapEventMap(publishedMap);
  });
}

export async function deleteEventMap(ctx: EventsContext, eventId: string, mapId: string) {
  return prisma.$transaction(async (tx) => {
    const map = await tx.eventMap.findFirst({
      where: { id: mapId, contaId: ctx.contaId, eventId },
      include: { versions: { select: { id: true } } },
    });
    if (!map) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);

    const ordersCount = await tx.eventMapOrder.count({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    const mapLots = await tx.eventTicketLot.findMany({
      where: { contaId: ctx.contaId, eventId, eventMapId: mapId },
      select: { id: true, quantitySold: true, _count: { select: { sales: true } } },
    });
    const mapLotHasSales = mapLots.some((lot) => lot.quantitySold > 0 || lot._count.sales > 0);
    const decision = decideEventMapDeletion({
      status: map.status,
      versionsCount: map.versions.length,
      ordersCount,
    });
    const preserveLotHistory = decision.action === 'DELETE' && mapLotHasSales;

    if (decision.action === 'BLOCK') {
      throw new EventsError('MAPA_NAO_EXCLUIVEL', decision.reason, 409);
    }

    if (decision.action === 'ARCHIVE' || preserveLotHistory) {
      const archived = await tx.eventMap.update({
        where: { id: mapId },
        data: {
          status: 'ARCHIVED',
          publicEnabled: false,
          publicSlug: null,
          publishedVersionId: null,
          archivedAt: new Date(),
        },
      });
      await recordMapAudit(tx, {
        contaId: ctx.contaId,
        actorUserId: ctx.userId,
        action: 'events.map.archive',
        entityId: mapId,
        eventId,
        before: map,
        after: archived,
        metadata: {
          reason: preserveLotHistory
            ? 'O mapa possui histórico de vendas em lotes da sessão.'
            : decision.action === 'ARCHIVE'
              ? decision.reason
              : 'O mapa foi arquivado para preservar os dados da sessão.',
        },
      });

      return { ok: true, action: 'ARCHIVE' as const };
    }

    if (decision.action === 'DEMOTE_TO_DRAFT') {
      const demoted = await tx.eventMap.update({
        where: { id: mapId },
        data: {
          status: 'DRAFT',
          publicEnabled: false,
          publishedVersionId: null,
          publicSlug: null,
          publishedAt: null,
          archivedAt: null,
        },
      });
      await recordMapAudit(tx, {
        contaId: ctx.contaId,
        actorUserId: ctx.userId,
        action: 'events.map.demote',
        entityId: mapId,
        eventId,
        before: map,
        after: demoted,
        metadata: { reason: decision.reason },
      });

      return { ok: true, action: 'DEMOTE_TO_DRAFT' as const };
    }

    // Session lots are children of this map. Delete them with an empty draft
    // map instead of turning them into global lots (which could collide by
    // name with another session and would lose their session ownership).
    await tx.eventTicketLot.deleteMany({ where: { contaId: ctx.contaId, eventId, eventMapId: mapId } });
    await tx.eventMap.delete({ where: { id: mapId } });
    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.delete',
      entityId: mapId,
      eventId,
      before: map,
    });

    return { ok: true, action: 'DELETE' as const };
  });
}

export async function duplicateEventMap(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: DuplicateEventMapInput = {},
) {
  return prisma.$transaction(async (tx) => {
    const lockedEvent = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SchoolEvent"
      WHERE "id" = ${eventId} AND "contaId" = ${ctx.contaId}
      FOR UPDATE
    `);
    if (lockedEvent.length === 0) {
      throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    }

    const mapCount = await tx.eventMap.count({ where: operationalEventMapsWhere(ctx.contaId, eventId) });
    if (!canCreateEventMap(mapCount)) {
      throw new EventsError(
        'LIMITE_MAPAS_EVENTO',
        `Cada evento pode ter no máximo ${MAX_EVENT_MAPS_PER_EVENT} mapas.`,
        409,
      );
    }

    const source = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
    const sessionStartsAt = input.startsAt ?? source.startsAt ?? source.event.startsAt;
    const sessionEndsAt = input.endsAt === undefined ? source.endsAt : input.endsAt;
    if (sessionStartsAt && sessionEndsAt && sessionEndsAt <= sessionStartsAt) {
      throw new EventsError('HORARIO_SESSAO_INVALIDO', 'O término da sessão deve ser posterior ao início.', 422);
    }
    const sourceDocument = readDraftDocument(source);
    const levelIdMap = new Map<string, string>();
    const sectionIdMap = new Map<string, string>();
    const objectIdMap = new Map<string, string>();
    const blockIdMap = new Map<string, string>();
    const rowIdMap = new Map<string, string>();
    const seatIdMap = new Map<string, string>();

    for (const level of source.levels) levelIdMap.set(level.id, createLocalId('level'));
    for (const section of source.sections) sectionIdMap.set(section.id, createLocalId('section'));
    for (const object of source.objects) objectIdMap.set(object.id, createLocalId('object'));
    for (const section of sourceDocument.sections) {
      for (const block of section.blocks) {
        blockIdMap.set(block.id, createLocalId('block'));
        for (const row of block.rows) {
          rowIdMap.set(row.id, createLocalId('row'));
          for (const seat of row.seats) seatIdMap.set(seat.id, createLocalId('seat'));
        }
      }
    }
    for (const seat of source.seats) {
      if (!seatIdMap.has(seat.id)) seatIdMap.set(seat.id, createLocalId('seat'));
    }
    const duplicatedDocument = remapDraftDocument(sourceDocument, {
      levelIds: levelIdMap,
      sectionIds: sectionIdMap,
      objectIds: objectIdMap,
      blockIds: blockIdMap,
      rowIds: rowIdMap,
      seatIds: seatIdMap,
    });

    const created = await tx.eventMap.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        name: input.name ?? `${source.name} (cópia)`,
        startsAt: sessionStartsAt,
        endsAt: sessionEndsAt,
        locationName: input.locationName === undefined ? source.locationName : input.locationName,
        locationAddress: input.locationAddress === undefined ? source.locationAddress : input.locationAddress,
        status: 'DRAFT',
        createdByUserId: ctx.userId,
        ...(duplicatedDocument ? { draftDocument: toInputJson(duplicatedDocument) } : {}),
      },
    });

    const sourceLotIds = [...new Set(source.sections.map((section) => section.lotId).filter(Boolean))] as string[];
    const sourceLots = sourceLotIds.length > 0
      ? await tx.eventTicketLot.findMany({ where: { contaId: ctx.contaId, eventId, id: { in: sourceLotIds } } })
      : [];
    const lotIdMap = new Map<string, string>();
    for (const lot of sourceLots) {
      const clonedLot = await tx.eventTicketLot.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          eventMapId: created.id,
          name: lot.name,
          ticketType: lot.ticketType,
          unitPrice: lot.unitPrice,
          quantityTotal: lot.quantityTotal,
          quantitySold: 0,
          saleStartsAt: lot.saleStartsAt,
          saleEndsAt: lot.saleEndsAt,
          status: lot.status === 'SOLD_OUT' && lot.quantityTotal > 0 ? 'ACTIVE' : lot.status,
          notes: lot.notes,
        },
      });
      lotIdMap.set(lot.id, clonedLot.id);
    }

    if (duplicatedDocument && lotIdMap.size > 0) {
      await tx.eventMap.update({
        where: { id: created.id },
        data: {
          draftDocument: toInputJson({
            ...duplicatedDocument,
            sections: duplicatedDocument.sections.map((section) => ({
              ...section,
              lotId: section.lotId ? lotIdMap.get(section.lotId) ?? section.lotId : section.lotId,
            })),
          }),
        },
      });
    }

    if (source.levels.length > 0) {
      await tx.eventMapLevel.createMany({
        data: source.levels.map((level) => ({
          id: levelIdMap.get(level.id)!,
          contaId: ctx.contaId,
          eventMapId: created.id,
          name: level.name,
          sortOrder: level.sortOrder,
          widthPx: level.widthPx,
          heightPx: level.heightPx,
          unit: level.unit,
          scale: level.scale,
        })),
      });
    }

    if (source.sections.length > 0) {
      await tx.eventMapSection.createMany({
        data: source.sections.map((section) => ({
          id: sectionIdMap.get(section.id)!,
          contaId: ctx.contaId,
          eventMapId: created.id,
          levelId: levelIdMap.get(section.levelId)!,
          lotId: section.lotId ? lotIdMap.get(section.lotId) ?? section.lotId : null,
          name: section.name,
          color: section.color,
          capacity: section.capacity,
          status: section.status,
          notes: section.notes,
        })),
      });
    }

    if (source.objects.length > 0) {
      await tx.eventMapObject.createMany({
        data: source.objects.map((object) => ({
          id: objectIdMap.get(object.id)!,
          contaId: ctx.contaId,
          eventMapId: created.id,
          levelId: levelIdMap.get(object.levelId)!,
          sectionId: object.sectionId ? sectionIdMap.get(object.sectionId) ?? null : null,
          type: object.type,
          data: toInputJson(object.data),
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          locked: object.locked,
          hidden: object.hidden,
          sortOrder: object.sortOrder,
        })),
      });
    }

    if (source.seats.length > 0) {
      await tx.eventSeat.createMany({
        data: source.seats.map((seat) => ({
          id: seatIdMap.get(seat.id) ?? createLocalId('seat'),
          contaId: ctx.contaId,
          eventMapId: created.id,
          levelId: levelIdMap.get(seat.levelId)!,
          sectionId: sectionIdMap.get(seat.sectionId)!,
          objectId: seat.objectId ? objectIdMap.get(seat.objectId) ?? null : null,
          rowIndex: seat.rowIndex,
          columnIndex: seat.columnIndex,
          technicalCode: seat.technicalCode,
          displayLabel: seat.displayLabel,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          status: seat.status === 'SOLD' || seat.status === 'HELD' ? 'AVAILABLE' : seat.status,
          accessible: seat.accessible,
          publicVisible: seat.publicVisible,
          x: seat.x,
          y: seat.y,
          size: seat.size,
          rotation: seat.rotation,
        })),
      });
    }

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.duplicate',
      entityId: created.id,
      eventId,
      after: created,
      metadata: { sourceMapId: mapId },
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, created.id));
  });
}

async function getPublicMapShellOrThrow(db: DbClient, publicSlug: string) {
  const map = await db.eventMap.findFirst({
    where: {
      publicSlug,
      status: 'PUBLISHED',
      publicEnabled: true,
      publishedVersionId: { not: null },
    },
    include: {
      event: {
        select: {
          id: true,
          contaId: true,
          name: true,
          startsAt: true,
          endsAt: true,
          locationName: true,
          locationAddress: true,
          status: true,
          finishedAt: true,
        },
      },
    },
  });

  if (!map || !isPublicEventMapVisible(map)) {
    throw new EventsError('MAPA_PUBLICO_NAO_ENCONTRADO', 'Mapa público não encontrado ou indisponível.', 404);
  }

  return map;
}

type EventMapPublicSeatRecord = Prisma.EventMapPublicSeatGetPayload<Prisma.EventMapPublicSeatDefaultArgs>;
type EventTicketRecord = Prisma.EventTicketGetPayload<Prisma.EventTicketDefaultArgs>;
function hasCompletePublicOrderTickets(order: { items: Array<{ ticket: EventTicketRecord | null }> }) {
  return order.items.length > 0 && order.items.every((item) => Boolean(item.ticket));
}

function mapPublicSeat(seat: EventMapPublicSeatRecord) {
  const metadata = seat.metadata && typeof seat.metadata === 'object' && !Array.isArray(seat.metadata)
    ? (seat.metadata as Record<string, unknown>)
    : {};

  return {
    id: seat.id,
    originalSeatId: seat.originalSeatId,
    levelId: seat.levelId,
    sectionId: seat.sectionId,
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

function snapshotRecord(snapshot: unknown) {
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : {};
}

export async function getPublicEventMap(publicSlug: string) {
  const map = await getPublicMapShellOrThrow(prisma, publicSlug);
  const version = await prisma.eventMapVersion.findFirst({
    where: { id: map.publishedVersionId!, contaId: map.contaId, eventMapId: map.id },
  });
  if (!version) throw new EventsError('VERSAO_PUBLICA_NAO_ENCONTRADA', 'Versão pública não encontrada.', 404);

  const seats = await prisma.eventMapPublicSeat.findMany({
    where: { contaId: map.contaId, versionId: version.id, publicVisible: true },
    orderBy: [{ sectionName: 'asc' }, { rowLabel: 'asc' }, { seatNumber: 'asc' }, { displayLabel: 'asc' }],
  });
  const snapshot = snapshotRecord(version.snapshot);
  const snapshotEvent = snapshotRecord(snapshot.event);
  const snapshotDate = (value: unknown, fallback: Date | null) => {
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value);
    return fallback;
  };
  const publishedStartsAt = snapshotDate(snapshot.startsAt, map.startsAt ?? map.event.startsAt)!;
  const publishedEndsAt = Object.hasOwn(snapshot, 'endsAt')
    ? (snapshot.endsAt === null ? null : snapshotDate(snapshot.endsAt, null))
    : map.endsAt;

  return {
    publicSlug: map.publicSlug!,
    publicUrl: publicMapPath(map.publicSlug),
    mapId: map.id,
    versionId: version.id,
    version: version.version,
    name: typeof snapshot.name === 'string' ? snapshot.name : map.name,
    publishedAt: version.publishedAt.toISOString(),
    event: {
      id: map.event.id,
      name: typeof snapshotEvent.name === 'string' ? snapshotEvent.name : map.event.name,
      startsAt: publishedStartsAt.toISOString(),
      endsAt: publishedEndsAt?.toISOString() ?? null,
      locationName: typeof snapshot.locationName === 'string' || snapshot.locationName === null
        ? snapshot.locationName
        : map.locationName ?? map.event.locationName,
      locationAddress: typeof snapshot.locationAddress === 'string' || snapshot.locationAddress === null
        ? snapshot.locationAddress
        : map.locationAddress ?? map.event.locationAddress,
      status: map.event.status,
    },
    levels: Array.isArray(snapshot.levels) ? snapshot.levels : [],
    sections: Array.isArray(snapshot.sections) ? snapshot.sections : [],
    objects: Array.isArray(snapshot.objects) ? snapshot.objects : [],
    document: snapshot.document && typeof snapshot.document === 'object' ? snapshot.document : null,
    seats: seats.map(mapPublicSeat),
    counts: {
      seats: seats.length,
      availableSeats: seats.filter((seat) => seat.status === 'AVAILABLE').length,
      soldSeats: seats.filter((seat) => seat.status === 'SOLD').length,
      heldSeats: seats.filter((seat) => seat.status === 'HELD').length,
    },
  };
}

export type PublicEventMapDTO = Awaited<ReturnType<typeof getPublicEventMap>>;

export async function reservePublicEventMapSeats(publicSlug: string, input: PublicSeatReservationInput) {
  return prisma.$transaction(async (tx) => {
    const initialMap = await getPublicMapShellOrThrow(tx, publicSlug);
    const expectedVersionId = initialMap.publishedVersionId;
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "EventMap"
      WHERE "id" = ${initialMap.id} AND "contaId" = ${initialMap.contaId}
      FOR UPDATE
    `);
    if (locked.length === 0) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    const map = await getPublicMapShellOrThrow(tx, publicSlug);
    if (map.id !== initialMap.id || map.publishedVersionId !== expectedVersionId || !map.publicEnabled) {
      throw new EventsError('MAPA_VERSAO_ALTERADA', 'A versão pública do mapa mudou. Atualize a página e selecione os assentos novamente.', 409);
    }
    assertEventTicketSalesOpen(map.event);

    const versionId = map.publishedVersionId!;
    if (input.checkoutKey) {
      const existing = await tx.eventMapReservation.findFirst({
        where: {
          contaId: map.contaId,
          eventMapId: map.id,
          versionId,
          checkoutKey: input.checkoutKey,
        },
        include: { seats: { include: { publicSeat: true } } },
        orderBy: { createdAt: 'desc' },
      });

      if (existing?.status === 'HELD' && existing.expiresAt >= new Date()) {
        const existingSeatIds = existing.seats.map((seat) => seat.publicSeatId).sort();
        const requestedSeatIds = [...new Set(input.seatIds)].sort();
        const sameSelection =
          existingSeatIds.length === requestedSeatIds.length &&
          existingSeatIds.every((seatId, index) => seatId === requestedSeatIds[index]);

        if (!sameSelection) {
          throw new EventsError(
            'RESERVA_EM_ANDAMENTO',
            'Já existe uma reserva em andamento para esta tentativa. Atualize a seleção e tente novamente.',
            409,
          );
        }

        const selectedSeats = existing.seats.map((seat) => seat.publicSeat);
        return {
          reservationId: existing.id,
          holdToken: existing.holdToken,
          expiresAt: existing.expiresAt.toISOString(),
          seats: selectedSeats.map((seat) => ({ ...mapPublicSeat(seat), status: 'HELD' as const })),
          totalAmount: selectedSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0),
        };
      }

      // The bounded expiry job releases seats. A targeted retry may still
      // clear this one expired idempotency key so it does not block a new hold.
      if (existing?.status === 'HELD' && existing.expiresAt < new Date()) {
        await tx.eventMapReservation.updateMany({
          where: { id: existing.id, contaId: map.contaId, status: 'HELD', expiresAt: { lt: new Date() } },
          data: { checkoutKey: null },
        });
      }

      if (existing && existing.status !== 'HELD') {
        await tx.eventMapReservation.updateMany({
          where: { id: existing.id, contaId: map.contaId, checkoutKey: input.checkoutKey },
          data: { checkoutKey: null },
        });
      }
    }

    const seats = await tx.eventMapPublicSeat.findMany({
      where: { contaId: map.contaId, versionId, id: { in: input.seatIds } },
    });
    const selection = validatePublicSeatSelection({
      requestedSeatIds: input.seatIds,
      seats: seats.map((seat) => ({ id: seat.id, status: seat.status, publicVisible: seat.publicVisible })),
    });
    if (!selection.ok) throw new EventsError('ASSENTOS_INDISPONIVEIS', selection.reason, 409);

    const lockedRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EventMapPublicSeat"
      WHERE "contaId" = ${map.contaId}
        AND "versionId" = ${versionId}
        AND id IN (${Prisma.join(selection.seatIds)})
        AND status = 'AVAILABLE'
      ORDER BY id
      FOR UPDATE
    `;
    if (lockedRows.length !== selection.seatIds.length) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos acabaram de ser reservados.', 409);
    }

    const updatedSeats = await tx.eventMapPublicSeat.updateMany({
      where: { contaId: map.contaId, versionId, id: { in: selection.seatIds }, status: 'AVAILABLE' },
      data: { status: 'HELD' },
    });
    if (updatedSeats.count !== selection.seatIds.length) {
      throw new EventsError('ASSENTOS_INDISPONIVEIS', 'Um ou mais assentos acabaram de ficar indisponíveis.', 409);
    }

    const expiresAt = getPublicReservationExpiration(new Date());
    const reservation = await tx.eventMapReservation.create({
      data: {
        contaId: map.contaId,
        eventId: map.eventId,
        eventMapId: map.id,
        versionId,
        holdToken: createPublicToken('hold'),
        checkoutKey: input.checkoutKey ?? null,
        buyerName: input.buyerName ?? null,
        buyerEmail: input.buyerEmail ?? null,
        expiresAt,
      },
    });

    await tx.eventMapReservationSeat.createMany({
      data: selection.seatIds.map((seatId) => ({
        id: createLocalId('reservationseat'),
        contaId: map.contaId,
        reservationId: reservation.id,
        publicSeatId: seatId,
      })),
    });

    const selectedSeats = seats.filter((seat) => selection.seatIds.includes(seat.id));
    return {
      reservationId: reservation.id,
      holdToken: reservation.holdToken,
      expiresAt: reservation.expiresAt.toISOString(),
      seats: selectedSeats.map((seat) => ({ ...mapPublicSeat(seat), status: 'HELD' as const })),
      totalAmount: selectedSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0),
    };
  });
}

export type PublicSeatReservationDTO = Awaited<ReturnType<typeof reservePublicEventMapSeats>>;

export { preparePublicEventMapCheckout } from './public-event-map-checkout-persistence';


/** Confirms possession of a public order capability without loading its relations. */
export async function assertPublicEventMapOrderCapability(orderId: string, accessToken: string): Promise<void> {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken },
    select: { id: true },
  });
  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);
}

export { getPublicEventMapOrderStatus } from './public-event-map-order-status.service';
export type { PublicOrderStatusDTO } from './public-event-map-order-status.service';


export async function getPublicEventMapOrderTickets(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken, status: 'CONFIRMED' },
    include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true, ticketArtworkUrl: true } },
      map: { select: { id: true, name: true, publicSlug: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true } },
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
  if (isTicketPaymentBlocked(order.paymentStatus)) {
    throw new EventsError('INGRESSOS_BLOQUEADOS', 'Ingressos temporariamente indisponíveis enquanto o pagamento é analisado.', 409);
  }
  if (order.ticketFulfillmentStatus !== 'ISSUED' || !hasCompletePublicOrderTickets(order)) {
    throw new EventsError('INGRESSOS_INDISPONIVEIS', 'Os ingressos ainda estão sendo emitidos. Tente novamente em instantes.', 409);
  }

  return {
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    sessionName: order.map.name,
    confirmedAt: (order.confirmedAt ?? order.paidAt ?? order.createdAt).toISOString(),
    event: {
      ...order.event,
      startsAt: (order.map.startsAt ?? order.event.startsAt).toISOString(),
      endsAt: order.map.endsAt?.toISOString() ?? null,
      locationName: order.map.locationName ?? order.event.locationName,
      locationAddress: order.map.locationAddress ?? order.event.locationAddress,
    },
    map: order.map,
    items: order.items.map((item) => ({
      id: item.id,
      sectionName: item.sectionName,
      seatLabel: item.seatLabel,
      technicalCode: item.technicalCode,
      unitPrice: toMoney(item.unitPriceSnapshot),
      ticketCode: item.ticket?.ticketCode ?? '',
      checkInCode: item.ticket?.checkInCode ?? toCheckInCode(item.ticket?.ticketCode ?? ''),
      ticketStatus: item.ticket?.status ?? 'VALID',
      seat: mapPublicSeat(item.publicSeat),
    })),
  };
}

export type PublicOrderTicketsDTO = Awaited<ReturnType<typeof getPublicEventMapOrderTickets>>;

export async function getEventMapOrderTicketsForAdmin(contaId: string, orderId: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, contaId, status: 'CONFIRMED' },
    include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true, ticketArtworkUrl: true } },
      map: { select: { id: true, name: true, publicSlug: true, startsAt: true, endsAt: true, locationName: true, locationAddress: true } },
      items: {
        include: {
          publicSeat: true,
          ticket: true,
        },
        orderBy: [{ sectionName: 'asc' }, { seatLabel: 'asc' }],
      },
    },
  });

  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido confirmado não encontrado.', 404);
  if (isTicketPaymentBlocked(order.paymentStatus)) {
    throw new EventsError('INGRESSOS_BLOQUEADOS', 'Ingressos temporariamente indisponíveis enquanto o pagamento é analisado.', 409);
  }
  if (order.ticketFulfillmentStatus !== 'ISSUED' || !hasCompletePublicOrderTickets(order)) {
    throw new EventsError('INGRESSOS_INDISPONIVEIS', 'Os ingressos ainda estão sendo emitidos.', 409);
  }

  return {
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    sessionName: order.map.name,
    confirmedAt: (order.confirmedAt ?? order.paidAt ?? order.createdAt).toISOString(),
    event: {
      ...order.event,
      startsAt: (order.map.startsAt ?? order.event.startsAt).toISOString(),
      endsAt: order.map.endsAt?.toISOString() ?? null,
      locationName: order.map.locationName ?? order.event.locationName,
      locationAddress: order.map.locationAddress ?? order.event.locationAddress,
    },
    map: order.map,
    items: order.items.map((item) => ({
      id: item.id,
      sectionName: item.sectionName,
      seatLabel: item.seatLabel,
      technicalCode: item.technicalCode,
      unitPrice: toMoney(item.unitPriceSnapshot),
      ticketCode: item.ticket?.ticketCode ?? '',
      checkInCode: item.ticket?.checkInCode ?? toCheckInCode(item.ticket?.ticketCode ?? ''),
      ticketStatus: item.ticket?.status ?? 'VALID',
      seat: mapPublicSeat(item.publicSeat),
    })),
  };
}

const PUBLIC_ORDER_RESEND_EMAIL_WINDOW_MS = 60 * 60 * 1000;

async function countRecentOrderAuditActions(
  contaId: string,
  orderId: string,
  action: string,
  sinceMs: number,
) {
  const since = new Date(Date.now() - sinceMs);
  return prisma.auditLog.count({
    where: {
      contaId,
      entityType: 'EventMapOrder',
      entityId: orderId,
      action,
      createdAt: { gte: since },
    },
  });
}

export async function requestPublicOrderTicketEmailResend(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken, status: 'CONFIRMED' },
    include: {
      event: { select: { name: true, startsAt: true, locationName: true, locationAddress: true } },
      map: { select: { name: true, publicSlug: true, startsAt: true, locationName: true, locationAddress: true } },
      items: { include: { ticket: true, publicSeat: { select: { lotName: true } } } },
    },
  });
  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido confirmado não encontrado.', 404);
  if (isTicketPaymentBlocked(order.paymentStatus)) {
    throw new EventsError('INGRESSOS_BLOQUEADOS', 'Ingressos temporariamente indisponíveis enquanto o pagamento é analisado.', 409);
  }

  const recentResends = await countRecentOrderAuditActions(
    order.contaId,
    order.id,
    'events.map.public.tickets_email.resend',
    PUBLIC_ORDER_RESEND_EMAIL_WINDOW_MS,
  );
  if (recentResends >= 3) {
    throw new EventsError('LIMITE_REENVIO_EMAIL', 'Limite de reenvios atingido. Aguarde alguns minutos.', 429);
  }

  const ticketCount = order.items.filter((item) => item.ticket).length;
  if (ticketCount === 0) {
    throw new EventsError('INGRESSOS_INDISPONIVEIS', 'Não há ingressos emitidos para este pedido.', 409);
  }
  const dedupeSuffix = `resend:${Math.floor(Date.now() / PUBLIC_ORDER_RESEND_EMAIL_WINDOW_MS)}`;

  await prisma.$transaction(async (tx) => {
    await enqueueEventTicketEmail(tx, {
      contaId: order.contaId,
      purchaseId: order.id,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      eventName: `${order.event.name} · ${order.map.name}`,
      eventStartsAt: order.map.startsAt ?? order.event.startsAt,
      eventLocation: [
        order.map.locationName ?? order.event.locationName,
        order.map.locationAddress ?? order.event.locationAddress,
      ].filter(Boolean).join(' — ') || null,
      ticketType: [...new Set(order.items.map((item) => item.publicSeat?.lotName).filter(Boolean))].join(', ') || 'Ingresso',
      ticketCount,
      ticketsPath: publicOrderTicketsPath(order.id, order.accessToken),
      statusPath: publicOrderStatusPath(order.map.publicSlug, order.id, order.accessToken),
      deliveryKey: dedupeSuffix,
    });

    await tx.auditLog.create({
      data: {
        contaId: order.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'events.map.public.tickets_email.resend',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({ buyerEmail: order.buyerEmail }),
      },
    });
  });

  return { ok: true as const, orderId: order.id, buyerEmail: order.buyerEmail };
}

export async function listEventPublicMapOrdersForAdmin(
  contaId: string,
  eventId: string,
  options: { page?: number; pageSize?: number; search?: string; status?: string } = {},
) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 6)));
  const search = options.search?.trim();
  const where: Prisma.EventMapOrderWhereInput = {
    contaId,
    eventId,
    ...(options.status ? { status: options.status as Prisma.EventMapOrderWhereInput['status'] } : {}),
    ...(search ? {
      OR: [
        { buyerName: { contains: search, mode: 'insensitive' } },
        { buyerEmail: { contains: search, mode: 'insensitive' } },
        { asaasPaymentId: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [orders, total, orderStatuses, ticketStatuses] = await Promise.all([
    prisma.eventMapOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      buyerName: true,
      buyerEmail: true,
      totalAmount: true,
      status: true,
      ticketFulfillmentStatus: true,
      paymentMethod: true,
      paymentStatus: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      createdAt: true,
      expiresAt: true,
      confirmedAt: true,
      paidAt: true,
      refundedAt: true,
      cancelledAt: true,
      map: { select: { id: true, name: true, publicSlug: true } },
      reservation: { select: { seats: { select: { id: true, publicSeat: { select: { lotName: true } } } } } },
      items: { select: { id: true, publicSeat: { select: { lotName: true } } } },
      tickets: { select: { id: true, status: true } },
    },
    }),
    prisma.eventMapOrder.count({ where }),
    prisma.eventMapOrder.groupBy({
      by: ['status', 'ticketFulfillmentStatus', 'paymentStatus'],
      where: { contaId, eventId },
      _count: { _all: true },
    }),
    prisma.eventTicket.groupBy({
      by: ['status'],
      where: { contaId, eventId, eventMapOrderId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const orderCount = (predicate: (_row: (typeof orderStatuses)[number]) => boolean) =>
    orderStatuses.reduce((sum, row) => sum + (predicate(row) ? row._count._all : 0), 0);
  const ticketCount = (status: (typeof ticketStatuses)[number]['status']) =>
    ticketStatuses.find((row) => row.status === status)?._count._all ?? 0;

  return {
    page,
    pageSize,
    total,
    summary: {
      ordersTotal: total,
      waitingPayment: orderCount((row) => row.status === 'PAYMENT_PENDING'),
      expired: orderCount((row) => row.status === 'EXPIRED'),
      issuing: orderCount((row) => row.status === 'CONFIRMED' && row.ticketFulfillmentStatus === 'PENDING'),
      issuanceFailed: orderCount((row) => row.status === 'CONFIRMED' && ['FAILED', 'REQUIRES_RECONCILIATION'].includes(row.ticketFulfillmentStatus)),
      completed: orderCount((row) => row.status === 'CONFIRMED' && row.ticketFulfillmentStatus === 'ISSUED'),
      refunding: orderCount((row) => ['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PAYMENT_REFUND_IN_PROGRESS'].includes(row.paymentStatus ?? '')),
      ticketsIssued: ticketCount('VALID') + ticketCount('USED'),
      checkedIn: ticketCount('USED'),
    },
    items: orders.map((order) => ({
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    ticketFulfillmentStatus: order.ticketFulfillmentStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    asaasPaymentId: order.asaasPaymentId,
    invoiceUrl: order.invoiceUrl,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    map: order.map,
    lotNames: [...new Set(
      (order.items.length > 0 ? order.items : order.reservation?.seats ?? [])
        .map((entry) => entry.publicSeat.lotName?.trim())
        .filter((name): name is string => Boolean(name)),
    )],
    seatCount: order.reservation?.seats.length ?? order.items.length,
    ticketCount: order.tickets.filter((ticket) => ticket.status === 'VALID' || ticket.status === 'USED').length,
    ticketsUsed: order.tickets.filter((ticket) => ticket.status === 'USED').length,
  })),
  };
}

export type EventPublicMapOrderListItemDTO = Awaited<ReturnType<typeof listEventPublicMapOrdersForAdmin>>['items'][number];

export async function verifyEventMapTicketForCheckIn(contaId: string, eventId: string, ticketCode: string) {
  const ticket = await verifyEventTicketForCheckIn(contaId, eventId, ticketCode);
  if (!ticket.seat) throw new EventsError('INGRESSO_INVALIDO', 'Ingresso sem assento vinculado.', 409);
  return ticket;
}

export async function markEventMapTicketUsed(
  contaId: string,
  eventId: string,
  ticketCode: string,
  actorUserId: string,
) {
  return markEventTicketUsed(contaId, eventId, ticketCode, actorUserId, {
    requireSeat: true,
    auditAction: 'events.map.ticket.check_in',
  });
}
