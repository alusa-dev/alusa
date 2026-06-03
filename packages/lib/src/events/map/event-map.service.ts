import {
  createCustomer,
  createPayment,
  listCustomers,
  listPayments,
  updateCustomer,
  getPixQrCode,
  type AsaasPayment,
} from '@alusa/asaas';
import { FinanceWebhookSideEffectStatus, Prisma, PrismaClient, type EventMapPublicSeatStatus } from '@prisma/client';

import {
  canEditEventMapDraft,
  decideEventMapDeletion,
  isPublicEventMapVisible,
  validatePublicSeatSelection,
  validateEventMapStatusTransition,
  validatePublishableEventMap,
} from '@alusa/domain/events';

import { prisma } from '../../prisma';
import { loadDecryptedAsaasCredentials } from '../../services/integracoes/asaas-credentials-service';
import { EventsError, type EventsContext } from '../events.service';
import type {
  CreateEventMapInput,
  DuplicateEventMapInput,
  PublicCheckoutInput,
  PublicSeatReservationInput,
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
  versions: {
    select: { id: true, version: true, status: true, seatCount: true, publishedAt: true, createdAt: true },
    orderBy: { version: 'desc' as const },
  },
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

function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function toAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildEventMapAsaasIdempotencyKey(scope: 'customer' | 'payment', orderId: string) {
  return `event-map:${scope}:${orderId}`;
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

function publicOrderStatusPath(publicSlug: string | null | undefined, orderId: string, accessToken: string) {
  const slug = publicSlug?.trim();
  const query = `token=${encodeURIComponent(accessToken)}`;
  return slug ? `/m/${slug}/pedido/${orderId}?${query}` : `/api/public/event-map-orders/${orderId}/status?${query}`;
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

function mapEventMap(record: EventMapRecord) {
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
      seatCount: version.seatCount,
      publishedAt: version.publishedAt.toISOString(),
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
      numbering: (group.numbering ?? {}) as Record<string, unknown>,
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
    const publicSlug = map.publicSlug ?? createPublicToken('map');
    const snapshot = { ...mapEventMap(map), publicSlug, publicEnabled: true, publicUrl: publicMapPath(publicSlug) };
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
              metadata: toInputJson({ objectId: seat.objectId, groupId: seat.groupId }),
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

    return mapEventMap(await getMapRecordOrThrow(tx, ctx.contaId, eventId, mapId));
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
        data: { status: 'ARCHIVED', publicEnabled: false, archivedAt: new Date() },
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

function mapPublicSeat(seat: EventMapPublicSeatRecord) {
  return {
    id: seat.id,
    originalSeatId: seat.originalSeatId,
    levelId: seat.levelId,
    sectionId: seat.sectionId,
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

async function buildPublicCheckoutResponse(
  order: PublicCheckoutOrderRecord,
  params?: { apiKey?: string | null; paymentMethod?: PublicCheckoutInput['paymentMethod']; publicSlug?: string | null },
) {
  let pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null = null;
  if (params?.paymentMethod === 'PIX' && params.apiKey && order.asaasPaymentId) {
    try {
      const qr = await getPixQrCode({ apiKey: params.apiKey, paymentId: order.asaasPaymentId });
      pixQrCode = {
        encodedImage: qr.encodedImage,
        payload: qr.payload,
        expirationDate: qr.expirationDate,
      };
    } catch (qrError) {
      console.warn('[event-map] Falha ao obter QR Code Pix:', qrError);
    }
  }

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
    ticketsUrl: order.status === 'CONFIRMED' ? publicOrderTicketsPath(order.id, order.accessToken) : null,
    statusUrl: publicOrderStatusPath(params?.publicSlug, order.id, order.accessToken),
    items: order.items.map((item) => ({
      ticketCode: item.ticket?.ticketCode ?? '',
      seatLabel: item.seatLabel,
      sectionName: item.sectionName,
    })),
    pixQrCode,
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
          _count: { select: { tickets: true } },
        },
      },
    },
  });
  if (expired.length === 0) return;

  const expirable = expired.filter((reservation) => {
    if (!reservation.order) return true;
    return (
      reservation.order.status === 'PAYMENT_PENDING' &&
      !reservation.order.asaasPaymentId &&
      reservation.order._count.tickets === 0
    );
  });
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
  await db.eventMapOrder.updateMany({
    where: {
      contaId,
      reservationId: { in: expirable.map((reservation) => reservation.id) },
      status: 'PAYMENT_PENDING',
      asaasPaymentId: null,
    },
    data: { status: 'EXPIRED', cancelledAt: now, paymentStatus: 'EXPIRED' },
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
    seatGroups: Array.isArray(snapshot.seatGroups) ? snapshot.seatGroups : [],
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
      maxSeats: 12,
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

    const expiresAt = addHours(new Date(), 24);
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

export async function completePublicEventMapCheckout(publicSlug: string, input: PublicCheckoutInput) {
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

    const totalAmount = publicSeats.reduce((sum, seat) => sum + toMoney(seat.unitPrice), 0);
    const expiresAt = addHours(new Date(), 24);
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
          totalAmount: decimal(totalAmount),
          status: 'PAYMENT_PENDING',
          paymentProvider: 'ASAAS',
          paymentMethod: input.paymentMethod,
          expiresAt,
          accessToken: createPublicToken('order'),
        },
        include: { items: { include: { ticket: true } } },
      }));

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'REFUNDED') {
      throw new EventsError('PEDIDO_NAO_REUTILIZAVEL', 'A reserva já foi encerrada. Selecione os assentos novamente.', 409);
    }

    await tx.eventMapReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'HELD',
        expiresAt,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
      },
    });

    if (order.paymentMethod !== input.paymentMethod) {
      await tx.eventMapOrder.update({
        where: { id: order.id },
        data: { paymentMethod: input.paymentMethod },
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
      expiresAt: order.expiresAt ?? expiresAt,
    };
  });

  console.info('[events.finance]', {
    action: 'eventMapOrder.checkout.prepared',
    contaId: pending.map.contaId,
    eventId: pending.map.eventId,
    orderId: pending.order.id,
    updated: Boolean(pending.order.asaasPaymentId),
  });

  try {
    const credentials = await loadDecryptedAsaasCredentials(pending.map.contaId);
    if (!credentials?.apiKey) {
      throw new EventsError('ASAAS_NAO_CONFIGURADO', 'Configure a integração Asaas para vender ingressos no mapa público.', 409);
    }

    if (pending.order.asaasPaymentId) {
      return buildPublicCheckoutResponse(pending.order, {
        apiKey: credentials.apiKey,
        paymentMethod: input.paymentMethod,
        publicSlug: pending.map.publicSlug,
      });
    }

    let customerId = '';
    try {
      const existing = await listCustomers({
        apiKey: credentials.apiKey,
        cpfCnpj: buyerDocument,
        limit: 10,
      });
      const activeCustomer = existing.data.find((c) => !c.deleted) ?? existing.data[0];
      if (activeCustomer) {
        customerId = activeCustomer.id;
        await updateCustomer({
          apiKey: credentials.apiKey,
          customerId,
          data: {
            name: input.buyerName,
            email: input.buyerEmail,
            address: input.buyerAddress ?? undefined,
            addressNumber: input.buyerAddressNumber ?? undefined,
            complement: input.buyerComplement ?? undefined,
            province: input.buyerProvince ?? undefined,
            postalCode: input.buyerPostalCode ?? undefined,
            externalReference: `event-map-order:${pending.order.id}`,
            notificationDisabled: false,
          },
        });
      }
    } catch (listError) {
      console.warn('[event-map] Falha ao listar/atualizar customer existente, criando novo:', listError);
    }

    if (!customerId) {
      const customer = await createCustomer({
        apiKey: credentials.apiKey,
        idempotencyKey: buildEventMapAsaasIdempotencyKey('customer', pending.order.id),
        data: {
          name: input.buyerName,
          email: input.buyerEmail,
          cpfCnpj: buyerDocument,
          address: input.buyerAddress ?? undefined,
          addressNumber: input.buyerAddressNumber ?? undefined,
          complement: input.buyerComplement ?? undefined,
          province: input.buyerProvince ?? undefined,
          postalCode: input.buyerPostalCode ?? undefined,
          externalReference: `event-map-order:${pending.order.id}`,
          notificationDisabled: false,
        },
      });
      customerId = customer.id;
    }

    const externalReference = `event-map-order:${pending.order.id}`;
    let payment: AsaasPayment;
    try {
      console.info('[events.finance]', {
        action: 'eventMapOrder.payment.create.start',
        contaId: pending.map.contaId,
        eventId: pending.map.eventId,
        orderId: pending.order.id,
      });
      payment = await createPayment({
        apiKey: credentials.apiKey,
        idempotencyKey: buildEventMapAsaasIdempotencyKey('payment', pending.order.id),
        data: {
          customer: customerId,
          value: pending.totalAmount,
          dueDate: toAsaasDate(pending.expiresAt),
          billingType: input.paymentMethod,
          description: `Ingressos - ${pending.map.event.name}`,
          externalReference,
        },
      });
    } catch (paymentError) {
      const reconciled = await listPayments({
        apiKey: credentials.apiKey,
        externalReference,
        limit: 10,
      }).catch((listError) => {
        console.warn('[event-map] Falha ao reconciliar cobrança Asaas por externalReference:', listError);
        return null;
      });
      const existingPayment = reconciled?.data.find((candidate) => !candidate.deleted) ?? null;
      if (!existingPayment) throw paymentError;
      payment = existingPayment;
    }

    console.info('[events.finance]', {
      action: 'eventMapOrder.payment.create',
      contaId: pending.map.contaId,
      eventId: pending.map.eventId,
      orderId: pending.order.id,
      asaasPaymentId: payment.id,
    });

    const updated = await prisma.eventMapOrder.update({
      where: { id: pending.order.id },
      data: {
        asaasCustomerId: customerId,
        asaasPaymentId: payment.id,
        paymentMethod: input.paymentMethod,
        paymentStatus: payment.status,
        invoiceUrl: payment.invoiceUrl ?? null,
      },
      include: { items: { include: { ticket: true } } },
    });
    return buildPublicCheckoutResponse(updated, {
      apiKey: credentials.apiKey,
      paymentMethod: input.paymentMethod,
      publicSlug: pending.map.publicSlug,
    });
  } catch (error) {
    const currentOrder = await prisma.eventMapOrder.findUnique({
      where: { id: pending.order.id },
      select: { asaasPaymentId: true },
    });
    if (!currentOrder?.asaasPaymentId) {
      await cancelPublicEventMapOrder(pending.order.id, 'Falha ao gerar cobrança Asaas.');
    }
    throw error;
  }
}

export type PublicCheckoutDTO = Awaited<ReturnType<typeof completePublicEventMapCheckout>>;

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
  const ticketsUrl = order.status === 'CONFIRMED' ? publicOrderTicketsPath(order.id, order.accessToken) : null;

  return {
    orderId: order.id,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    totalAmount: toMoney(order.totalAmount),
    status: order.status,
    paymentStatus: order.paymentStatus,
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

async function enqueuePublicOrderTicketEmail(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    orderId: string;
    buyerEmail: string;
    buyerName: string;
    eventName: string;
    eventStartsAt: Date;
    ticketCount: number;
    ticketsPath: string;
    statusPath: string;
  },
) {
  await tx.financeWebhookSideEffectOutbox.createMany({
    data: {
      contaId: params.contaId,
      effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL',
      dedupeKey: `${params.contaId}:EVENT_PUBLIC_ORDER_TICKET_EMAIL:${params.orderId}`,
      payload: toAuditJson({
        orderId: params.orderId,
        buyerEmail: params.buyerEmail,
        buyerName: params.buyerName,
        eventName: params.eventName,
        eventStartsAt: params.eventStartsAt.toISOString(),
        ticketCount: params.ticketCount,
        ticketsPath: params.ticketsPath,
        statusPath: params.statusPath,
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
      status: 'PAYMENT_PENDING',
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
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: eventMapOrderPaymentWhere(params),
      include: {
        map: true,
        event: { select: { name: true, startsAt: true } },
        reservation: { include: { seats: { include: { publicSeat: true } } } },
        items: { include: { ticket: true, publicSeat: true } },
      },
    });
    if (!order) return null;

    if (order.status === 'CONFIRMED' && order.items.length > 0) {
      return {
        orderId: order.id,
        status: order.status,
        ticketsCreated: order.items.filter((item) => item.ticket).length,
      };
    }

    if (order.status !== 'PAYMENT_PENDING') {
      throw new EventsError('PEDIDO_NAO_CONFIRMAVEL', 'Pedido público não está pendente de pagamento.', 409);
    }

    const reservation = order.reservation;
    if (!reservation || reservation.status !== 'HELD') {
      throw new EventsError('RESERVA_INVALIDA', 'Reserva do pedido público não está disponível para confirmação.', 409);
    }
    if (reservation.expiresAt < new Date()) {
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
      const item = await tx.eventMapOrderItem.create({
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
      const ticket = await tx.eventTicket.create({
        data: {
          contaId: order.contaId,
          eventId: order.eventId,
          eventMapOrderId: order.id,
          orderItemId: item.id,
          ticketCode: createPublicToken('ticket').toUpperCase(),
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

    await enqueuePublicOrderTicketEmail(tx, {
      contaId: order.contaId,
      orderId: order.id,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
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

export async function cancelPublicEventMapOrder(orderId: string, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.eventMapOrder.findFirst({
      where: { id: orderId },
      include: { reservation: { include: { seats: true } } },
    });
    if (!order || order.status === 'CANCELLED' || order.status === 'REFUNDED') return { ok: true };

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
      ticketStatus: item.ticket?.status ?? 'VALID',
      seat: mapPublicSeat(item.publicSeat),
    })),
  };
}
