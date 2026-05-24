import { Prisma, PrismaClient } from '@prisma/client';

import {
  validateEventMapStatusTransition,
  validatePublishableEventMap,
} from '@alusa/domain/events';

import { prisma } from '../../prisma';
import { EventsError, type EventsContext } from '../events.service';
import type {
  CreateEventMapInput,
  DuplicateEventMapInput,
  UpdateEventMapDraftInput,
} from './event-map.schema';

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
  seatGroups: { orderBy: [{ createdAt: 'asc' as const }] },
  seats: { orderBy: [{ technicalCode: 'asc' as const }] },
  versions: { select: { id: true, version: true, status: true, createdAt: true }, orderBy: { version: 'desc' as const } },
} satisfies Prisma.EventMapInclude;

type EventMapRecord = Prisma.EventMapGetPayload<{ include: typeof eventMapInclude }>;

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

function createLocalId(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
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
  if (map.status === 'PUBLISHED') {
    throw new EventsError(
      'MAPA_PUBLICADO',
      'Mapa publicado não pode ser editado diretamente. Duplique o mapa para criar um novo rascunho.',
      409,
    );
  }
  if (map.status === 'ARCHIVED') {
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

function mapEventMap(record: EventMapRecord) {
  return {
    id: record.id,
    contaId: record.contaId,
    eventId: record.eventId,
    event: { ...record.event, startsAt: record.event.startsAt.toISOString() },
    name: record.name,
    status: record.status,
    publishedVersionId: record.publishedVersionId,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    publishedAt: record.publishedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
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
      data: object.data,
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
      groupId: seat.groupId,
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
      createdAt: version.createdAt.toISOString(),
    })),
    seatGroups: record.seatGroups.map((group) => ({
      id: group.id,
      levelId: group.levelId,
      name: group.name,
      x: toNumber(group.x),
      y: toNumber(group.y),
      rotation: toNumber(group.rotation),
      rows: group.rows,
      columns: group.columns,
      seatWidth: toNumber(group.seatWidth),
      seatHeight: toNumber(group.seatHeight),
      gapX: toNumber(group.gapX),
      gapY: toNumber(group.gapY),
      paddingTop: toNumber(group.paddingTop),
      paddingRight: toNumber(group.paddingRight),
      paddingBottom: toNumber(group.paddingBottom),
      paddingLeft: toNumber(group.paddingLeft),
      numbering: group.numbering as Record<string, unknown>,
      locked: group.locked,
    })),
    counts: {
      levels: record.levels.length,
      sections: record.sections.length,
      seats: record.seats.length,
      availableSeats: record.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
    },
  };
}

export type EventMapDTO = ReturnType<typeof mapEventMap>;

export async function listEventMaps(ctx: Pick<EventsContext, 'contaId'>, eventId: string) {
  await getEventForMapOrThrow(prisma, ctx.contaId, eventId);
  const maps = await prisma.eventMap.findMany({
    where: { contaId: ctx.contaId, eventId },
    include: eventMapInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });

  return maps.map(mapEventMap);
}

export async function getEventMap(ctx: Pick<EventsContext, 'contaId'>, eventId: string, mapId: string) {
  return mapEventMap(await getMapRecordOrThrow(prisma, ctx.contaId, eventId, mapId));
}

export async function createEventMap(ctx: EventsContext, eventId: string, input: CreateEventMapInput) {
  return prisma.$transaction(async (tx) => {
    const event = await getEventForMapOrThrow(tx, ctx.contaId, eventId);
    assertNumberedSeatEvent(event);

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
      metadata: { source: input.templateMapId ? 'template' : 'blank' },
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
  validateDraftReferences(input);

  return prisma.$transaction(async (tx) => {
    const current = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!current) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);
    assertMapEditable(current);
    await assertLotsBelongToEvent(tx, ctx, eventId, input);

    await tx.eventSeat.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventSeatGroup.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapObject.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapSection.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });
    await tx.eventMapLevel.deleteMany({ where: { contaId: ctx.contaId, eventMapId: mapId } });

    await tx.eventMap.update({
      where: { id: mapId },
      data: { name: input.name ?? current.name },
    });

    await tx.eventMapLevel.createMany({
      data: input.levels.map((level) => ({
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

    if (input.sections.length > 0) {
      await tx.eventMapSection.createMany({
        data: input.sections.map((section) => ({
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

    if (input.objects.length > 0) {
      await tx.eventMapObject.createMany({
        data: input.objects.map((object) => ({
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

    if (input.seatGroups.length > 0) {
      await tx.eventSeatGroup.createMany({
        data: input.seatGroups.map((group) => ({
          id: group.id,
          contaId: ctx.contaId,
          eventMapId: mapId,
          levelId: group.levelId,
          name: group.name,
          x: decimal(group.x),
          y: decimal(group.y),
          rotation: decimal(group.rotation),
          rows: group.rows,
          columns: group.columns,
          seatWidth: decimal(group.seatWidth),
          seatHeight: decimal(group.seatHeight),
          gapX: decimal(group.gapX),
          gapY: decimal(group.gapY),
          paddingTop: decimal(group.paddingTop),
          paddingRight: decimal(group.paddingRight),
          paddingBottom: decimal(group.paddingBottom),
          paddingLeft: decimal(group.paddingLeft),
          numbering: toInputJson(group.numbering),
          locked: group.locked,
        })),
      });
    }

    if (input.seats.length > 0) {
      await tx.eventSeat.createMany({
        data: input.seats.map((seat) => ({
          id: seat.id,
          contaId: ctx.contaId,
          eventMapId: mapId,
          levelId: seat.levelId,
          sectionId: seat.sectionId,
          objectId: seat.objectId,
          groupId: seat.groupId,
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
        levels: input.levels.length,
        sections: input.sections.length,
        objects: input.objects.length,
        seatGroups: input.seatGroups.length,
        seats: input.seats.length,
      },
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId));
  });
}

export async function publishEventMap(ctx: EventsContext, eventId: string, mapId: string) {
  return prisma.$transaction(async (tx) => {
    const map = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
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

    const nextVersion = (map.versions[0]?.version ?? 0) + 1;
    const snapshot = mapEventMap(map);

    const version = await tx.eventMapVersion.create({
      data: {
        contaId: ctx.contaId,
        eventMapId: mapId,
        version: nextVersion,
        status: 'PUBLISHED',
        snapshot: toInputJson(snapshot),
      },
    });

    await tx.eventMap.update({
      where: { id: mapId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedVersionId: version.id,
      },
    });

    await recordMapAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.map.publish',
      entityId: mapId,
      eventId,
      before: { status: map.status },
      after: { status: 'PUBLISHED', version: nextVersion },
    });

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId));
  });
}

export async function deleteEventMap(ctx: EventsContext, eventId: string, mapId: string) {
  return prisma.$transaction(async (tx) => {
    const map = await tx.eventMap.findFirst({ where: { id: mapId, contaId: ctx.contaId, eventId } });
    if (!map) throw new EventsError('MAPA_NAO_ENCONTRADO', 'Mapa do evento não encontrado.', 404);

    if (map.status === 'PUBLISHED') {
      throw new EventsError('MAPA_PUBLICADO', 'Mapa publicado não pode ser excluído. Arquive ou duplique para criar uma nova versão.', 409);
    }

    const soldSeats = await tx.eventSeat.count({ where: { contaId: ctx.contaId, eventMapId: mapId, status: 'SOLD' } });
    if (soldSeats > 0) {
      throw new EventsError('MAPA_COM_VENDAS', 'Mapa com assentos vendidos não pode ser excluído.', 409);
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

    return { ok: true };
  });
}

export async function duplicateEventMap(
  ctx: EventsContext,
  eventId: string,
  mapId: string,
  input: DuplicateEventMapInput = {},
) {
  return prisma.$transaction(async (tx) => {
    const source = await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId);
    const levelIdMap = new Map<string, string>();
    const sectionIdMap = new Map<string, string>();
    const objectIdMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();

    const created = await tx.eventMap.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        name: input.name ?? `${source.name} (cópia)`,
        status: 'DRAFT',
        createdByUserId: ctx.userId,
      },
    });

    for (const level of source.levels) levelIdMap.set(level.id, createLocalId('level'));
    for (const section of source.sections) sectionIdMap.set(section.id, createLocalId('section'));
    for (const object of source.objects) objectIdMap.set(object.id, createLocalId('object'));
    for (const group of source.seatGroups) groupIdMap.set(group.id, createLocalId('seatgroup'));

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

    if (source.seatGroups.length > 0) {
      await tx.eventSeatGroup.createMany({
        data: source.seatGroups.map((group) => ({
          id: groupIdMap.get(group.id)!,
          contaId: ctx.contaId,
          eventMapId: created.id,
          levelId: levelIdMap.get(group.levelId)!,
          name: group.name,
          x: group.x,
          y: group.y,
          rotation: group.rotation,
          rows: group.rows,
          columns: group.columns,
          seatWidth: group.seatWidth,
          seatHeight: group.seatHeight,
          gapX: group.gapX,
          gapY: group.gapY,
          paddingTop: group.paddingTop,
          paddingRight: group.paddingRight,
          paddingBottom: group.paddingBottom,
          paddingLeft: group.paddingLeft,
          numbering: toInputJson(group.numbering as Record<string, unknown>),
          locked: group.locked,
        })),
      });
    }

    if (source.seats.length > 0) {
      await tx.eventSeat.createMany({
        data: source.seats.map((seat) => ({
          id: createLocalId('seat'),
          contaId: ctx.contaId,
          eventMapId: created.id,
          levelId: levelIdMap.get(seat.levelId)!,
          sectionId: sectionIdMap.get(seat.sectionId)!,
          objectId: seat.objectId ? objectIdMap.get(seat.objectId) ?? null : null,
          groupId: seat.groupId ? groupIdMap.get(seat.groupId) ?? null : null,
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
