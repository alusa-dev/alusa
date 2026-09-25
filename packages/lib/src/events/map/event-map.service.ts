import { FinanceWebhookSideEffectStatus, Prisma, PrismaClient, type EventMapPublicSeatStatus } from '@prisma/client';

import {
  canCreateEventMap,
  canEditEventMapDraft,
  countTicketLotCapacitiesFromMap,
  decideEventMapDeletion,
  isPublicEventMapVisible,
  MAX_EVENT_MAPS_PER_EVENT,
  resolvePublishedMapReplacement,
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
import { markEventTicketUsed, verifyEventTicketForCheckIn } from '../ticket-checkin.service';
import { getPublicReservationExpiration } from './public-reservation-policy';
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
  event: { select: { id: true, name: true, startsAt: true, status: true, ticketMode: true } },
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

function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
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

function publicOrderTicketsPath(orderId: string, accessToken: string) {
  return `/api/public/event-map-orders/${orderId}/tickets?token=${encodeURIComponent(accessToken)}`;
}

export function publicOrderStatusPath(publicSlug: string | null | undefined, orderId: string, accessToken: string) {
  const slug = publicSlug?.trim();
  const query = `orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(accessToken)}`;
  return slug ? `/m/${slug}?${query}` : `/api/public/event-map-orders/${orderId}/status?token=${encodeURIComponent(accessToken)}`;
}

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
    select: { id: true, contaId: true, name: true, startsAt: true, status: true, ticketMode: true, hasTickets: true },
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
    event: { ...record.event, startsAt: record.event.startsAt.toISOString() },
    name: record.name,
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
  const lots = await tx.eventTicketLot.findMany({
    where: { contaId: ctx.contaId, eventId },
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
  input: UpdateEventMapDraftInput,
) {
  const lotIds = [...new Set(input.sections.map((section) => section.lotId).filter(Boolean))] as string[];
  if (lotIds.length === 0) return;

  const lots = await tx.eventTicketLot.findMany({
    where: { contaId: ctx.contaId, eventId, id: { in: lotIds } },
    select: { id: true },
  });
  const found = new Set(lots.map((lot) => lot.id));
  const missing = lotIds.filter((lotId) => !found.has(lotId));

  if (missing.length > 0) {
    throw new EventsError('LOTE_INVALIDO', 'Um ou mais setores apontam para lotes de outro evento ou conta.', 422);
  }
}

export async function updateEventMapDraft(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: UpdateEventMapDraftInput,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);
    const previousSeats = await tx.eventSeat.findMany({
      where: { contaId: ctx.contaId, eventMapId: mapId },
      select: { id: true, status: true, publicVisible: true, accessible: true },
    });
    const materializedInput = materializeDocumentDraft(input, previousSeats);
    if (!materializedInput.document) validateDraftReferences(materializedInput);
    await assertLotsBelongToEvent(tx, ctx, eventId, materializedInput);

    await tx.eventSeat.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapObject.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapSection.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapLevel.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });

    await tx.eventMap.update({
      where: { id: mapId },
      data: {
        name: materializedInput.name ?? current.name,
        ...(materializedInput.document ? { draftDocument: toInputJson(materializedInput.document) } : {}),
      },
    });

    await tx.eventMapLevel.createMany({
      data: materializedInput.levels.map((level) => ({
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

    if (materializedInput.sections.length > 0) {
      await tx.eventMapSection.createMany({
        data: materializedInput.sections.map((section) => ({
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

    if (materializedInput.objects.length > 0) {
      await tx.eventMapObject.createMany({
        data: materializedInput.objects.map((object) => ({
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

    if (materializedInput.seats.length > 0) {
      await tx.eventSeat.createMany({
        data: materializedInput.seats.map((seat) => ({
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
        levels: materializedInput.levels.length,
        sections: materializedInput.sections.length,
        objects: materializedInput.objects.length,
        seats: materializedInput.seats.length,
      },
    });

    await syncNumberedSeatLotCapacities(tx, ctx, eventId, {
      sections: materializedInput.sections,
      seats: materializedInput.seats,
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
    const current = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);

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

async function replaceCurrentPublishedMap(
  tx: Prisma.TransactionClient,
  ctx: EventsContext,
  eventId: string,
  excludingMapId: string,
) {
  const current = await tx.eventMap.findFirst({
    where: { contaId: ctx.contaId, eventId, status: 'PUBLISHED', id: { not: excludingMapId } },
  });
  if (!current) return;

  const ordersCount = await tx.eventMapOrder.count({
    where: { contaId: ctx.contaId, eventMapId: current.id },
  });
  const replacement = resolvePublishedMapReplacement(ordersCount);

  if (replacement === 'ARCHIVE') {
    const archived = await tx.eventMap.update({
      where: { id: current.id },
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
      entityId: current.id,
      eventId,
      before: current,
      after: archived,
      metadata: { reason: 'Substituído por novo mapa publicado com histórico de pedidos.' },
    });
    return;
  }

  const demoted = await tx.eventMap.update({
    where: { id: current.id },
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
    entityId: current.id,
    eventId,
    before: current,
    after: demoted,
    metadata: { reason: 'Substituído por novo mapa publicado sem histórico de pedidos.' },
  });
}

export async function publishEventMap(ctx: EventsContext, eventId: string, mapId: string) {
  return prisma.$transaction(async (tx) => {
    const map = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
    const transition = validateEventMapStatusTransition(map.status, 'PUBLISHED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    if (map.status === 'DRAFT') {
      await replaceCurrentPublishedMap(tx, ctx, eventId, mapId);
    }

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
    await syncNumberedSeatLotCapacities(tx, ctx, eventId, {
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
    const decision = decideEventMapDeletion({
      status: map.status,
      versionsCount: map.versions.length,
      ordersCount,
    });

    if (decision.action === 'BLOCK') {
      throw new EventsError('MAPA_NAO_EXCLUIVEL', decision.reason, 409);
    }

    if (decision.action === 'ARCHIVE') {
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
        metadata: { reason: decision.reason },
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
    const mapCount = await tx.eventMap.count({ where: operationalEventMapsWhere(ctx.contaId, eventId) });
    if (!canCreateEventMap(mapCount)) {
      throw new EventsError(
        'LIMITE_MAPAS_EVENTO',
        `Cada evento pode ter no máximo ${MAX_EVENT_MAPS_PER_EVENT} mapas.`,
        409,
      );
    }

    const source = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
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
        status: 'DRAFT',
        createdByUserId: ctx.userId,
        ...(duplicatedDocument ? { draftDocument: toInputJson(duplicatedDocument) } : {}),
      },
    });

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
          lotId: section.lotId,
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
type EventMapOrderItemRecord = Prisma.EventMapOrderItemGetPayload<Prisma.EventMapOrderItemDefaultArgs>;
type EventTicketRecord = Prisma.EventTicketGetPayload<Prisma.EventTicketDefaultArgs>;
type PublicCheckoutOrderRecord = Prisma.EventMapOrderGetPayload<{
  include: { items: { include: { ticket: true } } };
}>;

function hasCompletePublicOrderTickets(order: { items: Array<{ ticket: EventTicketRecord | null }> }) {
  return order.items.length > 0 && order.items.every((item) => Boolean(item.ticket));
}

function ticketFulfillmentFailureStatus(reason: string | null | undefined) {
  const normalized = (reason ?? '').toUpperCase();
  return normalized.includes('RESERVA_EXPIRADA')
    || normalized.includes('ASSENTOS_INDISPONIVEIS')
    || normalized.includes('ASSENTOS_REVENDIDOS')
    || normalized.includes('RESERVA_INVALIDA')
    || normalized.includes('VALOR_PAGAMENTO_DIVERGENTE')
    || normalized.includes('PEDIDO_NAO_ENCONTRADO')
    ? 'REQUIRES_RECONCILIATION' as const
    : 'FAILED' as const;
}

function normalizeTicketFulfillmentError(reason: string | null | undefined) {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 500) : 'Falha ao emitir ingressos do pedido público.';
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

function parseEventMapOrderExternalReference(externalReference: string | null | undefined) {
  const prefix = 'event-map-order:';
  if (!externalReference?.startsWith(prefix)) return null;
  const orderId = externalReference.slice(prefix.length).trim();
  return orderId.length > 0 ? orderId : null;
}

function eventMapOrderPaymentWhere(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
}) {
  const orderId = parseEventMapOrderExternalReference(params.externalReference);
  return {
    contaId: params.contaId,
    OR: [
      { asaasPaymentId: params.asaasPaymentId },
      ...(orderId ? [{ id: orderId, asaasPaymentId: null }] : []),
    ],
  } satisfies Prisma.EventMapOrderWhereInput;
}

export function buildPublicEventMapCheckoutResponse(
  order: PublicCheckoutOrderRecord,
  params?: {
    publicSlug?: string | null;
    pixQrCode?: { encodedImage: string; payload: string; expirationDate: string } | null;
    bankSlipCode?: string | null;
    bankSlipBarcode?: string | null;
  },
) {
  return {
    orderId: order.id,
    accessToken: order.accessToken,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    expiresAt: order.expiresAt?.toISOString() ?? order.createdAt.toISOString(),
    asaasPaymentId: order.asaasPaymentId,
    invoiceUrl: order.invoiceUrl,
    ticketsUrl:
      order.status === 'CONFIRMED'
      && order.ticketFulfillmentStatus === 'ISSUED'
      && hasCompletePublicOrderTickets(order)
        ? publicOrderTicketsPath(order.id, order.accessToken)
        : null,
    ticketFulfillmentStatus: order.ticketFulfillmentStatus,
    statusUrl: publicOrderStatusPath(params?.publicSlug, order.id, order.accessToken),
    items: order.items.map((item) => ({
      ticketCode: item.ticket?.ticketCode ?? '',
      seatLabel: item.seatLabel,
      sectionName: item.sectionName,
    })),
    pixQrCode: params?.pixQrCode ?? null,
    bankSlipCode: params?.bankSlipCode ?? null,
    bankSlipBarcode: params?.bankSlipBarcode ?? null,
  };
}

function snapshotRecord(snapshot: Prisma.JsonValue) {
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : {};
}

async function expirePublicReservations(db: DbClient, contaId: string, now = new Date()) {
  const expired = await db.eventMapReservation.findMany({
    where: { contaId, status: 'HELD', expiresAt: { lt: now } },
    include: {
      seats: { select: { publicSeatId: true } },
      order: {
        select: {
          id: true,
          status: true,
          asaasPaymentId: true,
          paymentStatus: true,
          _count: { select: { tickets: true } },
        },
      },
    },
  });
  if (expired.length === 0) return;

  const expirable: typeof expired = [];
  for (const reservation of expired) {
    if (!reservation.order) {
      expirable.push(reservation);
      continue;
    }
    if (
      reservation.order.status !== 'PAYMENT_PENDING' ||
      reservation.order.asaasPaymentId ||
      reservation.order._count.tickets > 0 ||
      reservation.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
      reservation.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN'
    ) continue;

    // Claim order expiry before releasing its seats. This compare-and-set
    // races safely with checkout's payment-creation claim: only one wins.
    const expiredOrder = await db.eventMapOrder.updateMany({
      where: {
        id: reservation.order.id,
        contaId,
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        OR: [
          { paymentStatus: null },
          { paymentStatus: { notIn: ['PAYMENT_CREATION_IN_PROGRESS', 'PAYMENT_CREATION_UNKNOWN'] } },
        ],
      },
      data: { status: 'EXPIRED', cancelledAt: now, paymentStatus: 'EXPIRED' },
    });
    if (expiredOrder.count === 1) expirable.push(reservation);
  }
  const skipped = expired.length - expirable.length;
  if (skipped > 0) {
    console.info('[events.finance]', {
      action: 'eventMapReservation.expire.inline.skipped',
      contaId,
      skipped,
      reason: 'external_payment_or_operational_history_requires_job_reconciliation',
    });
  }
  if (expirable.length === 0) return;

  const expiredSeatIds = [...new Set(expirable.flatMap((reservation) => reservation.seats.map((seat) => seat.publicSeatId)))];
  if (expiredSeatIds.length > 0) {
    await db.eventMapPublicSeat.updateMany({
      where: { contaId, id: { in: expiredSeatIds }, status: 'HELD' },
      data: { status: 'AVAILABLE' },
    });
  }
  await db.eventMapReservation.updateMany({
    where: { contaId, id: { in: expirable.map((reservation) => reservation.id) }, status: 'HELD' },
    data: { status: 'EXPIRED', checkoutKey: null },
  });
}

async function syncPublicLotQuantity(tx: Prisma.TransactionClient, contaId: string, lotId: string) {
  const [aggregate, lot] = await Promise.all([
    tx.eventTicketSale.aggregate({
      where: { contaId, lotId, status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] } },
      _sum: { quantity: true },
    }),
    tx.eventTicketLot.findFirst({ where: { id: lotId, contaId } }),
  ]);
  if (!lot) return;

  const quantitySold = aggregate._sum.quantity ?? 0;
  const nextStatus =
    lot.status === 'ACTIVE' && quantitySold >= lot.quantityTotal
      ? 'SOLD_OUT'
      : lot.status === 'SOLD_OUT' && quantitySold < lot.quantityTotal
        ? 'ACTIVE'
        : lot.status;

  await tx.eventTicketLot.update({
    where: { id: lotId },
    data: { quantitySold, status: nextStatus },
  });
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

  return {
    publicSlug: map.publicSlug!,
    publicUrl: publicMapPath(map.publicSlug),
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
      locationName: map.event.locationName,
      locationAddress: map.event.locationAddress,
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
    const map = await getPublicMapShellOrThrow(tx, publicSlug);
    assertEventTicketSalesOpen(map.event);
    await expirePublicReservations(tx, map.contaId);

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

export async function preparePublicEventMapCheckout(publicSlug: string, input: PublicCheckoutInput) {
  const buyerDocument = normalizeDocument(input.buyerDocument);
  if (!buyerDocument) {
    throw new EventsError('DOCUMENTO_OBRIGATORIO', 'Informe o CPF/CNPJ do comprador para gerar a cobrança.', 422);
  }

  const pending = await prisma.$transaction(async (tx) => {
    const map = await getPublicMapShellOrThrow(tx, publicSlug);
    await expirePublicReservations(tx, map.contaId);

    const reservation = await tx.eventMapReservation.findFirst({
      where: {
        id: input.reservationId,
        holdToken: input.holdToken,
        contaId: map.contaId,
        eventMapId: map.id,
        versionId: map.publishedVersionId!,
        status: 'HELD',
      },
      include: {
        seats: { include: { publicSeat: true } },
        order: { include: { items: { include: { ticket: true } } } },
      },
    });
    if (!reservation) throw new EventsError('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada ou expirada.', 404);
    if (reservation.expiresAt < new Date()) {
      throw new EventsError('RESERVA_EXPIRADA', 'A reserva expirou. Selecione os assentos novamente.', 409);
    }

    const publicSeats = reservation.seats.map((entry) => entry.publicSeat);
    if (publicSeats.length === 0 || publicSeats.some((seat) => seat.status !== 'HELD')) {
      throw new EventsError('RESERVA_INVALIDA', 'A reserva possui assentos indisponíveis.', 409);
    }

    // Um pedido criado antes da finalização pode concluir o pagamento; uma nova
    // reserva sem pedido não pode transformar-se em venda após o encerramento.
    if (!reservation.order) {
      assertEventTicketSalesOpen(map.event);
    }

    const totalAmount = publicSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
    const proposedExpiresAt = getPublicReservationExpiration(new Date(), input.paymentMethod);
    const order =
      reservation.order ??
      (await tx.eventMapOrder.create({
        data: {
          contaId: map.contaId,
          eventId: map.eventId,
          eventMapId: map.id,
          versionId: map.publishedVersionId!,
          reservationId: reservation.id,
          buyerName: input.buyerName,
          buyerEmail: input.buyerEmail,
          buyerDocument: input.buyerDocument ?? null,
          buyerPhone: input.buyerPhone,
          totalAmount: decimal(totalAmount),
          status: 'PAYMENT_PENDING',
          paymentProvider: 'ASAAS',
          paymentMethod: input.paymentMethod,
          expiresAt: proposedExpiresAt,
          accessToken: createPublicToken('order'),
        },
        include: { items: { include: { ticket: true } } },
      }));

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'REFUNDED') {
      throw new EventsError('PEDIDO_NAO_REUTILIZAVEL', 'A reserva já foi encerrada. Selecione os assentos novamente.', 409);
    }
    if (
      (order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' || order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN') &&
      (order.buyerName !== input.buyerName || order.buyerEmail !== input.buyerEmail ||
        order.buyerDocument !== buyerDocument || order.buyerPhone !== input.buyerPhone ||
        order.paymentMethod !== input.paymentMethod)
    ) {
      throw new EventsError(
        'CHECKOUT_EM_RECONCILIACAO',
        'Esta tentativa de pagamento ainda está sendo verificada. Mantenha os dados e o meio de pagamento e consulte o pedido novamente.',
        409,
      );
    }
    if (order.asaasPaymentId && order.paymentMethod !== input.paymentMethod) {
      throw new EventsError(
        'METODO_PAGAMENTO_FIXO',
        'A cobrança deste pedido já foi gerada com outro meio de pagamento. Cancele o pedido e inicie uma nova compra para alterá-lo.',
        409,
      );
    }

    const expiresAt = order.asaasPaymentId
      ? order.expiresAt ?? proposedExpiresAt
      : proposedExpiresAt;

    await tx.eventMapReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'HELD',
        expiresAt,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
      },
    });

    if (
      order.buyerName !== input.buyerName ||
      order.buyerEmail !== input.buyerEmail ||
      order.buyerDocument !== buyerDocument ||
      order.buyerPhone !== input.buyerPhone ||
      order.paymentMethod !== input.paymentMethod ||
      order.expiresAt?.getTime() !== expiresAt.getTime()
    ) {
      await tx.eventMapOrder.update({
        where: { id: order.id },
        data: {
          buyerName: input.buyerName,
          buyerEmail: input.buyerEmail,
          buyerDocument,
          buyerPhone: input.buyerPhone,
          paymentMethod: input.paymentMethod,
          expiresAt,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        contaId: map.contaId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'events.map.public.checkout',
        entityType: 'EventMapOrder',
        entityId: order.id,
        metadata: toAuditJson({
          eventId: map.eventId,
          eventMapId: map.id,
          versionId: map.publishedVersionId,
          seats: publicSeats.map((seat) => seat.technicalCode),
          totalAmount,
          expiresAt: expiresAt.toISOString(),
        }),
      },
    });

    return {
      order,
      map,
      publicSeats,
      totalAmount,
      expiresAt,
    };
  });

  return pending;
}


export async function getPublicEventMapOrderStatus(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken },
    include: {
      event: { select: { id: true, name: true, startsAt: true, locationName: true } },
      map: { select: { id: true, name: true, publicSlug: true } },
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
    && hasCompletePublicOrderTickets(order);
  const ticketsUrl = ticketsAvailable ? publicOrderTicketsPath(order.id, order.accessToken) : null;
  let refundRequestUrl: string | null = null;
  if (
    order.paymentMethod === 'BOLETO'
    && order.status === 'CONFIRMED'
    && order.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:')
    && order.paymentStatus !== 'REFUND_DENIED'
    && order.paymentStatus !== 'REFUNDED'
  ) {
    const refundEffect = await prisma.financeWebhookSideEffectOutbox.findFirst({
      where: {
        contaId: order.contaId,
        dedupeKey: `${order.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`,
      },
      select: { payload: true },
    });
    const candidate = (refundEffect?.payload as { bankSlipRefundRequestUrl?: unknown } | null)
      ?.bankSlipRefundRequestUrl;
    if (typeof candidate === 'string') {
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
      startsAt: order.event.startsAt.toISOString(),
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

export async function enqueuePublicOrderCreatedEmail(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    orderId: string;
    buyerEmail: string;
    buyerName: string;
    eventName: string;
    eventStartsAt: Date;
    statusPath: string;
    invoiceUrl: string | null;
    paymentMethod: string;
    expiresAt: Date;
  },
) {
  await tx.financeWebhookSideEffectOutbox.createMany({
    data: {
      contaId: params.contaId,
      effectType: 'EVENT_PUBLIC_ORDER_CREATED_EMAIL',
      dedupeKey: `${params.contaId}:EVENT_PUBLIC_ORDER_CREATED_EMAIL:${params.orderId}`,
      payload: toAuditJson({
        orderId: params.orderId,
        buyerEmail: params.buyerEmail,
        buyerName: params.buyerName,
        eventName: params.eventName,
        eventStartsAt: params.eventStartsAt.toISOString(),
        statusPath: params.statusPath,
        invoiceUrl: params.invoiceUrl,
        paymentMethod: params.paymentMethod,
        expiresAt: params.expiresAt.toISOString(),
      }),
      status: FinanceWebhookSideEffectStatus.PENDING,
    },
    skipDuplicates: true,
  });
}

export async function syncPublicEventMapOrderPaymentCreated(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
}) {
  const orderId = parseEventMapOrderExternalReference(params.externalReference);
  if (!orderId) return null;

  const updated = await prisma.eventMapOrder.updateMany({
    where: {
      id: orderId,
      contaId: params.contaId,
      status: { in: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED'] },
      OR: [{ asaasPaymentId: null }, { asaasPaymentId: params.asaasPaymentId }],
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

export async function confirmPublicEventMapOrderPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
  paidAt?: Date | string | null;
  paidAmount?: number | null;
  allowReleasedReservation?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: eventMapOrderPaymentWhere(params),
      include: {
        map: true,
        event: { select: { name: true, startsAt: true, locationName: true, locationAddress: true } },
        reservation: { include: { seats: { include: { publicSeat: true } } } },
        items: { include: { ticket: true, publicSeat: true } },
      },
    });
    if (!order) return null;

    if (order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'ISSUED' && hasCompletePublicOrderTickets(order)) {
      return {
        orderId: order.id,
        status: order.status,
        ticketsCreated: order.items.filter((item) => item.ticket).length,
      };
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
          paymentStatus: params.paymentStatus ?? null,
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
            paymentStatus: params.paymentStatus ?? null,
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
        paymentStatus: params.paymentStatus ?? order.paymentStatus,
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
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
      eventLocation: [order.event.locationName, order.event.locationAddress].filter(Boolean).join(' — ') || null,
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

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);
/**
 * Converge financial state when the payment is confirmed in Asaas but the full
 * public-order confirmation flow cannot run (ex.: reserva liberada e assento
 * revendidos ou retidos por outro pedido).
 */
export async function reconcileEventMapOrderFinancialStateFromAsaas(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  paymentStatus?: string | null;
  invoiceUrl?: string | null;
  paidAt?: Date | string | null;
  paidAmount?: number | null;
  ticketFulfillmentError?: string | null;
}): Promise<{ orderId: string; status: 'CONFIRMED'; financialOnly: true } | null> {
  const paymentStatus = (params.paymentStatus ?? '').trim().toUpperCase();
  if (!PAID_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) return null;

  const paidAt = params.paidAt ? new Date(params.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: {
        ...eventMapOrderPaymentWhere(params),
        status: { in: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED', 'CONFIRMED'] },
      },
      include: {
        reservation: { include: { seats: { include: { publicSeat: { select: { status: true } } } } } },
      },
    });
    if (!order) return null;
    if (order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'REQUIRES_RECONCILIATION') {
      // A replayed payment webhook is already represented locally; preserve
      // idempotent success while the refund/fulfillment outbox is reconciled.
      return { orderId: order.id, status: 'CONFIRMED', financialOnly: true };
    }

    // A payment can arrive after its local hold has been released. If another
    // buyer already acquired one of those seats, preserve the payment truth,
    // issue no ticket, and enqueue one durable full refund for the actual paid
    // amount. The outbox's tenant-scoped dedupe key prevents webhook retries
    // from creating duplicate refund commands.
    const releasedOrder = order.status === 'EXPIRED' || order.status === 'CANCELLED';
    const seatsStillFree = order.reservation?.seats.length
      && order.reservation.seats.every((seat) => seat.publicSeat.status === 'AVAILABLE');
    // Available seats are reclaimed atomically by confirmPublic... before this
    // fallback runs. Do not downgrade a transient confirmation failure into a
    // financial-only state while the order can still be fulfilled normally.
    if (releasedOrder && seatsStillFree) return null;
    // Any missing or occupied seat makes fulfillment impossible right now.
    // A competing hold is as important as a completed resale: never steal it,
    // and do not leave the paid order waiting for a future webhook replay.
    const cannotFulfillLatePayment = releasedOrder && !seatsStillFree;

    const update = await tx.eventMapOrder.updateMany({
      where: {
        id: order.id,
        contaId: params.contaId,
        status: order.status,
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
        paymentStatus,
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
      const dedupeKey = `${params.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`;
      await tx.financeWebhookSideEffectOutbox.createMany({
        data: {
          contaId: params.contaId,
          effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
          dedupeKey,
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
          paymentStatus,
          financialOnly: true,
          latePaymentRefundQueued: Boolean(cannotFulfillLatePayment),
        }),
      },
    });

    return { orderId: order.id, status: 'CONFIRMED', financialOnly: true };
  });
}

export async function recordPublicOrderTicketFulfillmentFailure(params: {
  contaId: string;
  orderId: string;
  reason?: string | null;
}) {
  const reason = normalizeTicketFulfillmentError(params.reason);
  const updated = await prisma.eventMapOrder.updateMany({
    where: {
      id: params.orderId,
      contaId: params.contaId,
      status: 'CONFIRMED',
      ticketFulfillmentStatus: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      ticketFulfillmentStatus: ticketFulfillmentFailureStatus(reason),
      ticketFulfillmentAttempts: { increment: 1 },
      ticketFulfillmentLastAttemptAt: new Date(),
      ticketFulfillmentLastError: reason,
    },
  });

  return { updated: updated.count > 0, status: ticketFulfillmentFailureStatus(reason) };
}

export async function cancelPublicEventMapOrder(orderId: string, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: { id: orderId },
      include: { reservation: { include: { seats: true } } },
    });
    if (
      !order ||
      order.status === 'CANCELLED' ||
      order.status === 'EXPIRED' ||
      order.status === 'CONFIRMED' ||
      order.status === 'REFUNDED'
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
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), paymentStatus: reason ?? order.paymentStatus },
    });
    return { ok: true };
  });
}

export async function cancelPublicEventMapOrderByPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  reason?: string | null;
}) {
  const order = await prisma.eventMapOrder.findFirst({
    where: eventMapOrderPaymentWhere(params),
    select: { id: true },
  });
  if (!order) return null;
  return cancelPublicEventMapOrder(order.id, params.reason ?? 'Pagamento cancelado/expirado.');
}

export async function refundPublicEventMapOrderByPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  refundedAmount?: number | null;
  partial?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: eventMapOrderPaymentWhere(params),
      include: { items: { include: { ticket: true } } },
    });
    if (!order) return null;

    const refundedAmount = params.refundedAmount ?? toMoney(order.totalAmount);
    const status = params.partial && refundedAmount < toMoney(order.totalAmount) ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    const now = new Date();

    if (status === 'REFUNDED') {
      await tx.eventTicket.updateMany({
        where: { contaId: order.contaId, eventMapOrderId: order.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await tx.eventMapPublicSeat.updateMany({
        where: { contaId: order.contaId, id: { in: order.items.map((item) => item.publicSeatId) }, status: 'SOLD' },
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
    const updated = await tx.eventMapOrder.update({
      where: { id: order.id },
      data: {
        status,
        refundedAt: now,
        refundedAmount: decimal(refundedAmount),
        paymentStatus: status,
      },
    });
    return { orderId: updated.id, status: updated.status };
  });
}

export async function markPublicEventMapOrderRefundProcessingByPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  paymentStatus: string;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: eventMapOrderPaymentWhere(params),
    });
    if (!order) return null;

    const updated = await tx.eventMapOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: params.paymentStatus,
      },
    });

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
        where: {
          contaId: order.contaId,
          originType: 'TICKET_SALE',
          originId: { in: saleIds },
        },
        data: { paymentStatus: params.paymentStatus },
      });
    }

    return { orderId: updated.id, status: updated.status, paymentStatus: updated.paymentStatus };
  });
}

export async function getPublicEventMapOrderTickets(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken, status: 'CONFIRMED' },
    include: {
      event: { select: { id: true, name: true, startsAt: true, locationName: true, locationAddress: true } },
      map: { select: { id: true, name: true, publicSlug: true } },
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
  if (order.ticketFulfillmentStatus !== 'ISSUED' || !hasCompletePublicOrderTickets(order)) {
    throw new EventsError('INGRESSOS_INDISPONIVEIS', 'Os ingressos ainda estão sendo emitidos. Tente novamente em instantes.', 409);
  }

  return {
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    confirmedAt: (order.confirmedAt ?? order.paidAt ?? order.createdAt).toISOString(),
    event: {
      ...order.event,
      startsAt: order.event.startsAt.toISOString(),
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
      event: { select: { id: true, name: true, startsAt: true, locationName: true, locationAddress: true } },
      map: { select: { id: true, name: true, publicSlug: true } },
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
  if (order.ticketFulfillmentStatus !== 'ISSUED' || !hasCompletePublicOrderTickets(order)) {
    throw new EventsError('INGRESSOS_INDISPONIVEIS', 'Os ingressos ainda estão sendo emitidos.', 409);
  }

  return {
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    confirmedAt: (order.confirmedAt ?? order.paidAt ?? order.createdAt).toISOString(),
    event: {
      ...order.event,
      startsAt: order.event.startsAt.toISOString(),
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
      map: { select: { publicSlug: true } },
      items: { include: { ticket: true, publicSeat: { select: { lotName: true } } } },
    },
  });
  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido confirmado não encontrado.', 404);

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
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
      eventLocation: [order.event.locationName, order.event.locationAddress].filter(Boolean).join(' — ') || null,
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

export async function listEventPublicMapOrdersForAdmin(contaId: string, eventId: string) {
  const orders = await prisma.eventMapOrder.findMany({
    where: { contaId, eventId },
    orderBy: { createdAt: 'desc' },
    take: 250,
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
      createdAt: true,
      expiresAt: true,
      confirmedAt: true,
      paidAt: true,
      map: { select: { id: true, name: true, publicSlug: true } },
      items: { select: { id: true } },
      tickets: { select: { id: true, status: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    ticketFulfillmentStatus: order.ticketFulfillmentStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    asaasPaymentId: order.asaasPaymentId,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    map: order.map,
    seatCount: order.items.length,
    ticketCount: order.tickets.length,
    ticketsUsed: order.tickets.filter((ticket) => ticket.status === 'USED').length,
  }));
}

export type EventPublicMapOrderListItemDTO = Awaited<ReturnType<typeof listEventPublicMapOrdersForAdmin>>[number];

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
