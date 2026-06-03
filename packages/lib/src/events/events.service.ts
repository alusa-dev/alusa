import { deletePayment as deleteAsaasPayment } from '@alusa/asaas';
import { Prisma, PrismaClient, EventPaymentMethod } from '@prisma/client';

const mapToEventPaymentMethod = (method?: string | null): EventPaymentMethod => {
  if (!method) return 'OTHER';
  const allowed = ['CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER', 'COMPLIMENTARY', 'OTHER'];
  if (allowed.includes(method)) return method as EventPaymentMethod;
  return 'OTHER';
};

import {
  calculateEventMetrics,
  resolveEventParticipantPayment,
  validateCostumeAssignmentStatusTransition,
  validateSchoolEventStatusTransition,
  validateTicketLotStatusTransition,
  validateTicketSaleStatusTransition,
  type EventMetrics,
} from '@alusa/domain/events';

import { prisma } from '../prisma';
import { loadDecryptedAsaasCredentials } from '../services/integracoes/asaas-credentials-service';
import {
  canRemoveEventParticipant,
  type EventParticipantRemovalDecision,
  type EventParticipantRemovalFacts,
} from './event-participant-lifecycle';
import type {
  CreateCostumeAssignmentInput,
  CreateCostumeInput,
  CreateEventFinancialEntryInput,
  CreateSchoolEventInput,
  CreateTicketLotInput,
  CreateTicketSaleInput,
  UpdateTicketSaleInput,
  ListSchoolEventsQuery,
  UpdateCostumeAssignmentInput,
  UpdateCostumeInput,
  UpdateEventFinancialEntryInput,
  UpdateSchoolEventInput,
  UpdateTicketLotInput,
  CreateEventParticipantInput,
  ReactivateEventParticipantInput,
  QuitarParticipantFeeInput,
} from './events.schema';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class EventsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EventsError';
  }
}

export type EventsContext = {
  contaId: string;
  userId: string;
};

export type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export type EventsListMeta = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const eventInclude = {
  responsibleUser: { select: { id: true, nome: true, email: true } },
  createdBy: { select: { id: true, nome: true, email: true } },
  ticketLots: true,
  ticketSales: true,
  costumes: true,
  assignments: true,
  financialEntries: true,
  participants: true,
} satisfies Prisma.SchoolEventInclude;

type SchoolEventRecord = Prisma.SchoolEventGetPayload<{ include: typeof eventInclude }>;

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function pageMeta(total: number, page = 1, pageSize = 25): EventsListMeta {
  return {
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function recordEventAudit(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    eventId?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
) {
  await tx.eventAudit.create({
    data: {
      contaId: params.contaId,
      eventId: params.eventId ?? null,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
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
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata === undefined ? undefined : toAuditJson(params.metadata),
    },
  });
}

type ParticipantPaymentSnapshot = {
  percentPaid: number;
  financialStatus: string;
  totalPaid: number;
  totalRefunded: number;
  netPaid: number;
  realizedAt: Date | null;
  entryStatus: 'PENDING' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
};

function financialEntryStatusFromParticipantStatus(status: string): ParticipantPaymentSnapshot['entryStatus'] {
  if (status === 'QUITADO') return 'RECEIVED';
  if (status === 'CANCELADO') return 'CANCELLED';
  if (status === 'ESTORNADO') return 'REFUNDED';
  if (status === 'ESTORNADO_PARCIAL') return 'PARTIALLY_REFUNDED';
  return 'PENDING';
}

function applyParticipantPaymentSnapshotsToEntries<T extends { id: string; status: any; actualAmount: any; realizedAt?: Date | null; refundedAmount?: any; netAmount?: any }>(
  entries: T[],
  snapshots: Map<string, ParticipantPaymentSnapshot> | undefined,
): T[] {
  if (!snapshots?.size) return entries;

  return entries.map((entry) => {
    const snapshot = snapshots.get(entry.id);
    if (!snapshot) return entry;

    return {
      ...entry,
      status: snapshot.entryStatus,
      actualAmount: snapshot.totalPaid > 0 ? decimal(snapshot.totalPaid) : null,
      refundedAmount: snapshot.totalRefunded > 0 ? decimal(snapshot.totalRefunded) : (entry.refundedAmount ?? decimal(0)),
      netAmount: snapshot.netPaid > 0 ? decimal(snapshot.netPaid) : null,
      realizedAt: snapshot.realizedAt,
    };
  });
}

function buildMetrics(
  record: Pick<SchoolEventRecord, 'ticketSales' | 'ticketLots' | 'financialEntries' | 'assignments' | 'costumes'>,
  paymentSnapshots?: Map<string, ParticipantPaymentSnapshot>,
): EventMetrics {
  const financialEntries = applyParticipantPaymentSnapshotsToEntries(record.financialEntries, paymentSnapshots);

  return calculateEventMetrics({
    ticketSales: record.ticketSales.map((sale) => ({
      status: sale.status,
      quantity: sale.quantity,
      totalAmount: toMoney(sale.totalAmount),
    })),
    ticketLots: record.ticketLots.map((lot) => ({
      quantityTotal: lot.quantityTotal,
      quantitySold: lot.quantitySold,
      unitPrice: toMoney(lot.unitPrice),
    })),
    financialEntries: financialEntries.map((entry) => ({
      type: entry.type,
      status: entry.status,
      expectedAmount: toMoney(entry.expectedAmount),
      actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
      refundedAmount: entry.refundedAmount == null ? null : toMoney(entry.refundedAmount),
      originType: entry.originType,
      category: entry.category,
    })),
    costumeAssignments: record.assignments.map((assignment) => ({
      status: assignment.status,
      billingMode: assignment.billingMode,
      chargedValue: assignment.chargedValue == null ? null : toMoney(assignment.chargedValue),
      isPaid: assignment.isPaid,
    })),
    costumes: record.costumes.map((costume) => ({
      schoolCost: toMoney(costume.schoolCost),
      quantity: costume.quantity,
    })),
  });
}

export function mapSchoolEvent(record: SchoolEventRecord, paymentSnapshots?: Map<string, ParticipantPaymentSnapshot>) {
  const metrics = buildMetrics(record, paymentSnapshots);

  return {
    id: record.id,
    contaId: record.contaId,
    name: record.name,
    description: record.description,
    type: record.type,
    status: record.status,
    startsAt: record.startsAt.toISOString(),
    endsAt: toIso(record.endsAt),
    locationName: record.locationName,
    locationAddress: record.locationAddress,
    estimatedCapacity: record.estimatedCapacity,
    responsibleUserId: record.responsibleUserId,
    responsibleUser: record.responsibleUser,
    hasTickets: record.hasTickets,
    ticketMode: record.ticketMode,
    hasCostumes: record.hasCostumes,
    hasFinancialControl: record.hasFinancialControl,
    notes: record.notes,
    registrationFee: toMoney(record.registrationFee),
    createdByUserId: record.createdByUserId,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    cancelledAt: toIso(record.cancelledAt),
    finishedAt: toIso(record.finishedAt),
    archivedAt: toIso(record.archivedAt),
    metrics,
    counts: {
      lots: record.ticketLots.length,
      ticketSales: record.ticketSales.length,
      costumes: record.costumes.length,
      costumeAssignments: record.assignments.length,
      financialEntries: record.financialEntries.length,
    },
  };
}

export type SchoolEventDTO = ReturnType<typeof mapSchoolEvent>;

function buildEventWhere(contaId: string, query: ListSchoolEventsQuery): Prisma.SchoolEventWhereInput {
  const where: Prisma.SchoolEventWhereInput = { contaId };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { locationName: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.responsibleUserId) where.responsibleUserId = query.responsibleUserId;
  if (query.hasTickets !== undefined) where.hasTickets = query.hasTickets;
  if (query.hasCostumes !== undefined) where.hasCostumes = query.hasCostumes;
  if (query.hasFinancialControl !== undefined) where.hasFinancialControl = query.hasFinancialControl;

  if (query.fromDate || query.toDate) {
    where.startsAt = {
      ...(query.fromDate ? { gte: query.fromDate } : {}),
      ...(query.toDate ? { lte: query.toDate } : {}),
    };
  }

  return where;
}

async function getEventRecordOrThrow(contaId: string, eventId: string, db: DbClient = prisma) {
  const event = await db.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    include: eventInclude,
  });

  if (!event) {
    throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  }

  return event;
}

function assertOperationalEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED' || status === 'FINISHED') {
    throw new EventsError(
      'EVENTO_BLOQUEADO',
      'Este evento não aceita novas alterações operacionais.',
      409,
    );
  }
}

function assertFinancialAdjustmentEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED') {
    throw new EventsError(
      'EVENTO_BLOQUEADO',
      'Este evento não aceita ajustes financeiros.',
      409,
    );
  }
}

async function assertEventCanBeCancelled(tx: Prisma.TransactionClient, contaId: string, eventId: string) {
  const [openEntries, openSales, openOrders, heldReservations] = await Promise.all([
    tx.eventFinancialEntry.count({
      where: {
        contaId,
        eventId,
        status: { in: ['EXPECTED', 'PENDING'] },
      },
    }),
    tx.eventTicketSale.count({
      where: {
        contaId,
        eventId,
        status: { in: ['PENDING', 'PAID'] },
      },
    }),
    tx.eventMapOrder.count({
      where: {
        contaId,
        eventId,
        status: { in: ['PAYMENT_PENDING', 'CONFIRMED', 'PARTIALLY_REFUNDED'] },
      },
    }),
    tx.eventMapReservation.count({
      where: {
        contaId,
        eventId,
        status: 'HELD',
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  const blockers = [
    openEntries > 0 ? `${openEntries} lançamento(s) financeiro(s) aberto(s)` : null,
    openSales > 0 ? `${openSales} venda(s) ativa(s)` : null,
    openOrders > 0 ? `${openOrders} pedido(s) público(s) ativo(s)` : null,
    heldReservations > 0 ? `${heldReservations} reserva(s) pública(s) ativa(s)` : null,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw new EventsError(
      'EVENTO_COM_PENDENCIAS',
      `Não é possível cancelar o evento. Resolva antes: ${blockers.join(', ')}.`,
      409,
    );
  }
}

async function assertTicketLotCanBeCancelled(tx: Prisma.TransactionClient, contaId: string, lotId: string) {
  const [activeSales, pendingOrders, heldSeats] = await Promise.all([
    tx.eventTicketSale.count({
      where: { contaId, lotId, status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] } },
    }),
    tx.eventMapOrderItem.count({
      where: {
        contaId,
        lotId,
        order: { status: { in: ['PAYMENT_PENDING', 'CONFIRMED', 'PARTIALLY_REFUNDED'] } },
      },
    }),
    tx.eventMapPublicSeat.count({
      where: { contaId, lotId, status: 'HELD' },
    }),
  ]);

  const blockers = [
    activeSales > 0 ? `${activeSales} venda(s) ativa(s)` : null,
    pendingOrders > 0 ? `${pendingOrders} item(ns) em pedido público ativo` : null,
    heldSeats > 0 ? `${heldSeats} assento(s) reservado(s)` : null,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw new EventsError(
      'LOTE_COM_PENDENCIAS',
      `Não é possível cancelar o lote. Resolva antes: ${blockers.join(', ')}.`,
      409,
    );
  }
}

function resolveTicketSettings(input: {
  hasTickets?: boolean;
  ticketMode?: SchoolEventRecord['ticketMode'];
}, current?: Pick<SchoolEventRecord, 'hasTickets' | 'ticketMode'>) {
  if (input.ticketMode) {
    return {
      ticketMode: input.ticketMode,
      hasTickets: input.ticketMode !== 'NONE',
    };
  }

  if (input.hasTickets === false) {
    return { ticketMode: 'NONE' as const, hasTickets: false };
  }

  if (input.hasTickets === true) {
    return {
      ticketMode: current?.ticketMode && current.ticketMode !== 'NONE' ? current.ticketMode : ('SIMPLE' as const),
      hasTickets: true,
    };
  }

  return {
    ticketMode: current?.ticketMode,
    hasTickets: current?.hasTickets,
  };
}

export async function listSchoolEvents(ctx: Pick<EventsContext, 'contaId'>, query: ListSchoolEventsQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const where = buildEventWhere(ctx.contaId, query);

  const [total, records] = await Promise.all([
    prisma.schoolEvent.count({ where }),
    prisma.schoolEvent.findMany({
      where,
      include: eventInclude,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const paymentSnapshots = await buildParticipantPaymentSnapshots(ctx, records);
  const data = records.map((record) => mapSchoolEvent(record, paymentSnapshots));
  const summary = data.reduce(
    (acc, event) => {
      if (event.status === 'ACTIVE') acc.active += 1;
      if (event.status === 'PLANNING') acc.planning += 1;
      acc.receitaPrevista += event.metrics.receitaPrevista;
      acc.receitaRealizada += event.metrics.receitaRealizada;
      acc.custoRealizado += event.metrics.custoRealizado;
      acc.resultadoPrevisto += event.metrics.resultadoPrevisto;
      return acc;
    },
    {
      active: 0,
      planning: 0,
      receitaPrevista: 0,
      receitaRealizada: 0,
      custoRealizado: 0,
      resultadoPrevisto: 0,
    },
  );

  return { data, summary, meta: pageMeta(total, page, pageSize) };
}

export async function getSchoolEvent(ctx: Pick<EventsContext, 'contaId'>, eventId: string) {
  const record = await getEventRecordOrThrow(ctx.contaId, eventId);
  const paymentSnapshots = await buildParticipantPaymentSnapshots(ctx, [record]);
  return mapSchoolEvent(record, paymentSnapshots);
}

export async function createSchoolEvent(ctx: EventsContext, input: CreateSchoolEventInput) {
  return prisma.$transaction(async (tx) => {
    const ticketSettings = resolveTicketSettings(input);
    const created = await tx.schoolEvent.create({
      data: {
        contaId: ctx.contaId,
        name: input.name,
        description: input.description,
        type: input.type,
        status: input.status,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        locationName: input.locationName,
        locationAddress: input.locationAddress,
        estimatedCapacity: input.estimatedCapacity,
        responsibleUserId: input.responsibleUserId,
        hasTickets: ticketSettings.hasTickets ?? input.hasTickets,
        ticketMode: ticketSettings.ticketMode ?? input.ticketMode,
        hasCostumes: input.hasCostumes,
        hasFinancialControl: input.hasFinancialControl,
        registrationFee: input.registrationFee != null ? decimal(input.registrationFee) : null,
        notes: input.notes,
        createdByUserId: ctx.userId,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.schoolEvent.create',
      entityType: 'SchoolEvent',
      entityId: created.id,
      eventId: created.id,
      after: created,
    });

    return mapSchoolEvent(await getEventRecordOrThrow(ctx.contaId, created.id, tx));
  });
}

export async function updateSchoolEvent(ctx: EventsContext, eventId: string, input: UpdateSchoolEventInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.schoolEvent.findFirst({ where: { id: eventId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    if (current.status === 'ARCHIVED') {
      throw new EventsError('EVENTO_ARQUIVADO', 'Evento arquivado não pode ser editado.', 409);
    }
    const ticketSettings = resolveTicketSettings(input, current);

    const updated = await tx.schoolEvent.update({
      where: { id: eventId },
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        locationName: input.locationName,
        locationAddress: input.locationAddress,
        estimatedCapacity: input.estimatedCapacity,
        responsibleUserId: input.responsibleUserId,
        hasTickets: ticketSettings.hasTickets,
        ticketMode: ticketSettings.ticketMode,
        hasCostumes: input.hasCostumes,
        hasFinancialControl: input.hasFinancialControl,
        registrationFee: input.registrationFee != null ? decimal(input.registrationFee) : null,
        notes: input.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.schoolEvent.update',
      entityType: 'SchoolEvent',
      entityId: updated.id,
      eventId: updated.id,
      before: current,
      after: updated,
    });

    return mapSchoolEvent(await getEventRecordOrThrow(ctx.contaId, updated.id, tx));
  });
}

export async function updateSchoolEventStatus(ctx: EventsContext, eventId: string, nextStatus: SchoolEventRecord['status']) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.schoolEvent.findFirst({ where: { id: eventId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);

    const transition = validateSchoolEventStatusTransition(current.status, nextStatus);
    if (!transition.ok) {
      throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);
    }
    if (nextStatus === 'CANCELLED') {
      await assertEventCanBeCancelled(tx, ctx.contaId, eventId);
    }

    const now = new Date();
    const updated = await tx.schoolEvent.update({
      where: { id: eventId },
      data: {
        status: nextStatus,
        cancelledAt: nextStatus === 'CANCELLED' ? now : current.cancelledAt,
        finishedAt: nextStatus === 'FINISHED' ? now : current.finishedAt,
        archivedAt: nextStatus === 'ARCHIVED' ? now : current.archivedAt,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.schoolEvent.status.update',
      entityType: 'SchoolEvent',
      entityId: eventId,
      eventId,
      before: current,
      after: updated,
      metadata: { previousStatus: current.status, nextStatus },
    });

    return mapSchoolEvent(await getEventRecordOrThrow(ctx.contaId, eventId, tx));
  });
}

export async function listEventResources(ctx: Pick<EventsContext, 'contaId'>) {
  const [users, alunos, responsaveis, turmas, events] = await Promise.all([
    prisma.usuario.findMany({
      where: {
        OR: [{ contaId: ctx.contaId }, { acessosConta: { some: { contaId: ctx.contaId, status: 'ATIVO' } } }],
        status: 'ATIVO',
      },
      select: { id: true, nome: true, email: true, role: true },
      orderBy: { nome: 'asc' },
      take: 200,
    }),
    prisma.aluno.findMany({
      where: { contaId: ctx.contaId, status: 'ATIVO' },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
      take: 500,
    }),
    prisma.responsavel.findMany({
      where: { contaId: ctx.contaId },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
      take: 500,
    }),
    prisma.turma.findMany({
      where: { contaId: ctx.contaId, status: 'ATIVO' },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
      take: 300,
    }),
    prisma.schoolEvent.findMany({
      where: { contaId: ctx.contaId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, startsAt: true, status: true },
      orderBy: { startsAt: 'desc' },
      take: 200,
    }),
  ]);

  return {
    users,
    alunos,
    responsaveis,
    turmas,
    events: events.map((event) => ({
      ...event,
      startsAt: event.startsAt.toISOString(),
    })),
  };
}

export function mapTicketLot(lot: Prisma.EventTicketLotGetPayload<{ include: { event: { select: { id: true; name: true; startsAt: true } } } }>) {
  return {
    id: lot.id,
    contaId: lot.contaId,
    eventId: lot.eventId,
    event: { ...lot.event, startsAt: lot.event.startsAt.toISOString() },
    name: lot.name,
    ticketType: lot.ticketType,
    unitPrice: toMoney(lot.unitPrice),
    quantityTotal: lot.quantityTotal,
    quantitySold: lot.quantitySold,
    quantityAvailable: Math.max(lot.quantityTotal - lot.quantitySold, 0),
    saleStartsAt: toIso(lot.saleStartsAt),
    saleEndsAt: toIso(lot.saleEndsAt),
    status: lot.status,
    notes: lot.notes,
    createdAt: lot.createdAt.toISOString(),
    updatedAt: lot.updatedAt.toISOString(),
  };
}

export async function listTicketLots(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string } = {}) {
  const lots = await prisma.eventTicketLot.findMany({
    where: { contaId: ctx.contaId, ...(input.eventId ? { eventId: input.eventId } : {}) },
    include: { event: { select: { id: true, name: true, startsAt: true } } },
    orderBy: [{ createdAt: 'desc' }],
  });
  return lots.map(mapTicketLot);
}

async function getTicketLotDto(db: DbClient, contaId: string, lotId: string) {
  const lot = await db.eventTicketLot.findFirst({
    where: { id: lotId, contaId },
    include: { event: { select: { id: true, name: true, startsAt: true } } },
  });
  if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);
  return mapTicketLot(lot);
}

export async function createTicketLot(ctx: EventsContext, input: CreateTicketLotInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertOperationalEvent(event.status);

    const existing = await tx.eventTicketLot.findFirst({
      where: { contaId: ctx.contaId, eventId: input.eventId, name: input.name },
    });
    if (existing) {
      throw new EventsError('LOTE_JA_EXISTE', 'Já existe um lote com este nome neste evento.', 409);
    }

    const lot = await tx.eventTicketLot.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        name: input.name,
        ticketType: input.ticketType,
        unitPrice: decimal(input.unitPrice),
        quantityTotal: input.quantityTotal,
        saleStartsAt: input.saleStartsAt,
        saleEndsAt: input.saleEndsAt,
        status: input.status,
        notes: input.notes,
      },
    });

    if (!event.hasTickets) {
      await tx.schoolEvent.update({ where: { id: event.id }, data: { hasTickets: true } });
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketLot.create',
      entityType: 'EventTicketLot',
      entityId: lot.id,
      eventId: event.id,
      after: lot,
    });

    return getTicketLotDto(tx, ctx.contaId, lot.id);
  });
}

export async function updateTicketLot(ctx: EventsContext, lotId: string, input: UpdateTicketLotInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketLot.findFirst({
      where: { id: lotId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!current) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);
    assertOperationalEvent(current.event.status);

    if (input.name && input.name !== current.name) {
      const existing = await tx.eventTicketLot.findFirst({
        where: { contaId: ctx.contaId, eventId: current.eventId, name: input.name },
      });
      if (existing) {
        throw new EventsError('LOTE_JA_EXISTE', 'Já existe um lote com este nome neste evento.', 409);
      }
    }

    if (input.quantityTotal != null && input.quantityTotal < current.quantitySold) {
      throw new EventsError('QUANTIDADE_INVALIDA', 'A quantidade total não pode ser menor que a vendida.', 422);
    }

    if (input.unitPrice != null && toMoney(current.unitPrice) !== input.unitPrice) {
      const paidSales = await tx.eventTicketSale.count({
        where: { contaId: ctx.contaId, lotId, status: 'PAID' },
      });
      if (paidSales > 0) {
        throw new EventsError(
          'LOTE_COM_VENDAS_PAGAS',
          'Não altere o valor de lote com vendas pagas; encerre este lote e crie um novo.',
          409,
        );
      }
    }

    if (input.status) {
      const transition = validateTicketLotStatusTransition(current.status, input.status);
      if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);
      if (input.status === 'CANCELLED') {
        await assertTicketLotCanBeCancelled(tx, ctx.contaId, lotId);
      }
    }

    const updated = await tx.eventTicketLot.update({
      where: { id: lotId },
      data: {
        name: input.name,
        ticketType: input.ticketType,
        unitPrice: input.unitPrice == null ? undefined : decimal(input.unitPrice),
        quantityTotal: input.quantityTotal,
        saleStartsAt: input.saleStartsAt,
        saleEndsAt: input.saleEndsAt,
        status: input.status,
        notes: input.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketLot.update',
      entityType: 'EventTicketLot',
      entityId: lotId,
      eventId: current.eventId,
      before: current,
      after: updated,
    });

    return getTicketLotDto(tx, ctx.contaId, lotId);
  });
}

export function mapTicketSale(
  sale: Prisma.EventTicketSaleGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      lot: { select: { id: true; name: true; ticketType: true } };
      aluno: { select: { id: true; nome: true } };
      responsavel: { select: { id: true; nome: true } };
      createdBy: { select: { id: true; nome: true } };
    };
  }>,
) {
  return {
    id: sale.id,
    contaId: sale.contaId,
    eventId: sale.eventId,
    event: { ...sale.event, startsAt: sale.event.startsAt.toISOString() },
    lotId: sale.lotId,
    lot: sale.lot,
    buyerName: sale.buyerName,
    aluno: sale.aluno,
    responsavel: sale.responsavel,
    quantity: sale.quantity,
    unitPriceSnapshot: toMoney(sale.unitPriceSnapshot),
    totalAmount: toMoney(sale.totalAmount),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    soldAt: sale.soldAt.toISOString(),
    paidAt: toIso(sale.paidAt),
    cancelledAt: toIso(sale.cancelledAt),
    refundedAt: toIso(sale.refundedAt),
    createdBy: sale.createdBy,
    notes: sale.notes,
    revenueEntryId: sale.revenueEntryId,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
    source: sale.eventMapOrderId ? ('PUBLIC_ORDER' as const) : ('MANUAL_SALE' as const),
    eventMapOrderId: sale.eventMapOrderId,
    asaasPaymentId: sale.asaasPaymentId,
  };
}

function mapPendingPublicOrderAsTicketSale(
  order: Prisma.EventMapOrderGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      reservation: {
        include: {
          seats: {
            include: {
              publicSeat: {
                select: { lotId: true; lotName: true };
              };
            };
          };
        };
      };
    };
  }>,
) {
  const seats = order.reservation?.seats ?? [];
  const lots = seats
    .map((seat) => {
      if (!seat.publicSeat.lotId && !seat.publicSeat.lotName) return null;
      return {
        id: seat.publicSeat.lotId ?? `public-seat:${order.id}`,
        name: seat.publicSeat.lotName ?? 'Mapa público',
        ticketType: 'OTHER' as const,
      };
    })
    .filter((lot): lot is { id: string; name: string; ticketType: 'OTHER' } => Boolean(lot));
  const uniqueLots = lots.filter((lot, index, arr) => arr.findIndex((entry) => entry.id === lot.id) === index);
  const primaryLot = uniqueLots[0] ?? null;
  const lotName =
    uniqueLots.length <= 1
      ? (primaryLot?.name ?? 'Mapa público')
      : `${primaryLot?.name ?? 'Mapa público'} +${uniqueLots.length - 1}`;

  return {
    id: order.id,
    contaId: order.contaId,
    eventId: order.eventId,
    event: { ...order.event, startsAt: order.event.startsAt.toISOString() },
    lotId: primaryLot?.id ?? `public-order:${order.id}`,
    lot: {
      id: primaryLot?.id ?? `public-order:${order.id}`,
      name: lotName,
      ticketType: primaryLot?.ticketType ?? 'OTHER',
    },
    buyerName: order.buyerName,
    aluno: null,
    responsavel: null,
    quantity: seats.length,
    unitPriceSnapshot: seats.length > 0 ? toMoney(order.totalAmount) / seats.length : toMoney(order.totalAmount),
    totalAmount: toMoney(order.totalAmount),
    paymentMethod: null,
    paymentMethodLabel: 'Checkout público',
    status: 'RESERVED' as const,
    soldAt: order.createdAt.toISOString(),
    paidAt: null,
    cancelledAt: toIso(order.cancelledAt),
    refundedAt: toIso(order.refundedAt),
    createdBy: null,
    notes: order.paymentStatus ?? 'Aguardando pagamento do checkout público.',
    revenueEntryId: null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    source: 'PUBLIC_ORDER' as const,
    eventMapOrderId: order.id,
    asaasPaymentId: order.asaasPaymentId,
    reservationExpiresAt: toIso(order.expiresAt),
    invoiceUrl: order.invoiceUrl,
    ticketsUrl: null,
  };
}

export async function listTicketSales(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string } = {}) {
  const [sales, pendingOrders] = await Promise.all([
    prisma.eventTicketSale.findMany({
      where: { contaId: ctx.contaId, ...(input.eventId ? { eventId: input.eventId } : {}) },
      include: {
        event: { select: { id: true, name: true, startsAt: true } },
        lot: { select: { id: true, name: true, ticketType: true } },
        aluno: { select: { id: true, nome: true } },
        responsavel: { select: { id: true, nome: true } },
        createdBy: { select: { id: true, nome: true } },
      },
      orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.eventMapOrder.findMany({
      where: {
        contaId: ctx.contaId,
        status: 'PAYMENT_PENDING',
        ...(input.eventId ? { eventId: input.eventId } : {}),
      },
      include: {
        event: { select: { id: true, name: true, startsAt: true } },
        reservation: {
          include: {
            seats: {
              include: {
                publicSeat: {
                  select: { lotId: true, lotName: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
  ]);

  const publicOrderIds = [...new Set(sales.map((sale) => sale.eventMapOrderId).filter((orderId): orderId is string => Boolean(orderId)))];
  const publicOrders = publicOrderIds.length
    ? await prisma.eventMapOrder.findMany({
        where: { contaId: ctx.contaId, id: { in: publicOrderIds } },
        select: { id: true, status: true, accessToken: true, invoiceUrl: true, asaasPaymentId: true },
      })
    : [];
  const publicOrdersById = new Map(publicOrders.map((order) => [order.id, order]));

  const mappedSales = sales.map((sale) => {
    const dto = mapTicketSale(sale);
    if (!sale.eventMapOrderId) return dto;

    const order = publicOrdersById.get(sale.eventMapOrderId);
    return {
      ...dto,
      source: 'PUBLIC_ORDER' as const,
      asaasPaymentId: dto.asaasPaymentId ?? order?.asaasPaymentId ?? null,
      invoiceUrl: order?.invoiceUrl ?? null,
      ticketsUrl:
        order?.status === 'CONFIRMED'
          ? `/api/events/public-orders/${order.id}/tickets`
          : null,
    };
  });

  return [...mappedSales, ...pendingOrders.map(mapPendingPublicOrderAsTicketSale)].sort(
    (left, right) => new Date(right.soldAt).getTime() - new Date(left.soldAt).getTime(),
  );
}

async function getTicketSaleDto(db: DbClient, contaId: string, saleId: string) {
  const sale = await db.eventTicketSale.findFirst({
    where: { id: saleId, contaId },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      lot: { select: { id: true, name: true, ticketType: true } },
      aluno: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
      createdBy: { select: { id: true, nome: true } },
    },
  });
  if (!sale) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  return mapTicketSale(sale);
}

async function syncLotQuantity(tx: Prisma.TransactionClient, contaId: string, lotId: string) {
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

export async function createTicketSale(ctx: EventsContext, input: CreateTicketSaleInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EventTicketLot" WHERE id = ${input.lotId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;

    const lot = await tx.eventTicketLot.findFirst({
      where: { id: input.lotId, contaId: ctx.contaId, eventId: input.eventId },
      include: { event: true },
    });
    if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);
    assertOperationalEvent(lot.event.status);

    if (lot.status !== 'ACTIVE') {
      throw new EventsError('LOTE_INATIVO', 'Somente lotes ativos podem receber vendas.', 409);
    }

    const now = new Date();
    if (lot.saleStartsAt && lot.saleStartsAt > now) {
      throw new EventsError('VENDA_FORA_DO_PERIODO', 'As vendas deste lote ainda não começaram.', 409);
    }
    if (lot.saleEndsAt && lot.saleEndsAt < now) {
      throw new EventsError('VENDA_FORA_DO_PERIODO', 'As vendas deste lote já encerraram.', 409);
    }

    const sold = await tx.eventTicketSale.aggregate({
      where: { contaId: ctx.contaId, lotId: lot.id, status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] } },
      _sum: { quantity: true },
    });
    const quantitySold = sold._sum.quantity ?? 0;
    if (quantitySold + input.quantity > lot.quantityTotal) {
      throw new EventsError('ESTOQUE_INSUFICIENTE', 'Não há ingressos suficientes neste lote.', 409);
    }

    const saleStatus = input.paymentMethod === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : input.status;
    if (!['PENDING', 'PAID', 'COMPLIMENTARY'].includes(saleStatus)) {
      throw new EventsError('STATUS_VENDA_INVALIDO', 'Use pendente, pago ou cortesia ao criar venda.', 422);
    }

    const unitPrice = toMoney(lot.unitPrice);
    const totalAmount = saleStatus === 'COMPLIMENTARY' ? 0 : unitPrice * input.quantity;
    const sale = await tx.eventTicketSale.create({
      data: {
        contaId: ctx.contaId,
        eventId: lot.eventId,
        lotId: lot.id,
        buyerName: input.buyerName,
        alunoId: input.alunoId,
        responsavelId: input.responsavelId,
        quantity: input.quantity,
        unitPriceSnapshot: decimal(unitPrice),
        totalAmount: decimal(totalAmount),
        paymentMethod: input.paymentMethod,
        status: saleStatus,
        soldAt: input.soldAt ?? now,
        paidAt: saleStatus === 'PAID' ? now : null,
        createdByUserId: ctx.userId,
        notes: input.notes,
      },
    });

    if (saleStatus !== 'COMPLIMENTARY' && totalAmount > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: lot.eventId,
          type: 'REVENUE',
          category: 'Venda de ingresso',
          description: `Venda de ingresso - ${lot.name}`,
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

    await syncLotQuantity(tx, ctx.contaId, lot.id);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.create',
      entityType: 'EventTicketSale',
      entityId: sale.id,
      eventId: lot.eventId,
      after: sale,
      metadata: { lotId: lot.id },
    });

    return getTicketSaleDto(tx, ctx.contaId, sale.id);
  });
}

export async function markTicketSalePaid(ctx: EventsContext, saleId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    const transition = validateTicketSaleStatusTransition(current.status, 'PAID');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const now = new Date();
    const updated = await tx.eventTicketSale.update({
      where: { id: saleId },
      data: { status: 'PAID', paidAt: now },
    });

    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'RECEIVED', actualAmount: current.totalAmount, realizedAt: now },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.markPaid',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: current.eventId,
      before: current,
      after: updated,
    });

    return getTicketSaleDto(tx, ctx.contaId, saleId);
  });
}

export async function cancelTicketSale(ctx: EventsContext, saleId: string, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    const transition = validateTicketSaleStatusTransition(current.status, 'CANCELLED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const updated = await tx.eventTicketSale.update({
      where: { id: saleId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), notes: reason ?? current.notes },
    });
    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncLotQuantity(tx, ctx.contaId, current.lotId);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.cancel',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: current.eventId,
      before: current,
      after: updated,
      metadata: { reason },
    });

    return getTicketSaleDto(tx, ctx.contaId, saleId);
  });
}

export async function refundTicketSale(ctx: EventsContext, saleId: string, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    const transition = validateTicketSaleStatusTransition(current.status, 'REFUNDED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const now = new Date();
    const updated = await tx.eventTicketSale.update({
      where: { id: saleId },
      data: { status: 'REFUNDED', refundedAt: now, refundedAmount: current.totalAmount, notes: reason ?? current.notes },
    });
    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'REFUNDED', refundedAt: now, actualAmount: current.totalAmount, refundedAmount: current.totalAmount, netAmount: decimal(0) },
    });
    await syncLotQuantity(tx, ctx.contaId, current.lotId);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.refund',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: current.eventId,
      before: current,
      after: updated,
      metadata: { reason },
    });

    return getTicketSaleDto(tx, ctx.contaId, saleId);
  });
}

export function mapCostume(costume: Prisma.EventCostumeGetPayload<{ include: { event: { select: { id: true; name: true; startsAt: true } }; assignments: true } }>) {
  return {
    id: costume.id,
    contaId: costume.contaId,
    eventId: costume.eventId,
    event: { ...costume.event, startsAt: costume.event.startsAt.toISOString() },
    name: costume.name,
    description: costume.description,
    category: costume.category,
    size: costume.size,
    color: costume.color,
    accessories: costume.accessories,
    schoolCost: costume.schoolCost == null ? null : toMoney(costume.schoolCost),
    chargedValue: costume.chargedValue == null ? null : toMoney(costume.chargedValue),
    supplier: costume.supplier,
    quantity: costume.quantity,
    notes: costume.notes,
    assignmentsCount: costume.assignments.length,
    createdAt: costume.createdAt.toISOString(),
    updatedAt: costume.updatedAt.toISOString(),
  };
}

export async function listCostumes(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string } = {}) {
  const costumes = await prisma.eventCostume.findMany({
    where: { contaId: ctx.contaId, ...(input.eventId ? { eventId: input.eventId } : {}) },
    include: { event: { select: { id: true, name: true, startsAt: true } }, assignments: true },
    orderBy: { createdAt: 'desc' },
  });
  return costumes.map(mapCostume);
}

async function getCostumeDto(db: DbClient, contaId: string, costumeId: string) {
  const costume = await db.eventCostume.findFirst({
    where: { id: costumeId, contaId },
    include: { event: { select: { id: true, name: true, startsAt: true } }, assignments: true },
  });
  if (!costume) throw new EventsError('FIGURINO_NAO_ENCONTRADO', 'Figurino não encontrado.', 404);
  return mapCostume(costume);
}

export async function createCostume(ctx: EventsContext, input: CreateCostumeInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertFinancialAdjustmentEvent(event.status);

    const costume = await tx.eventCostume.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        name: input.name,
        description: input.description,
        category: input.category,
        size: input.size,
        color: input.color,
        accessories: input.accessories,
        schoolCost: input.schoolCost == null ? null : decimal(input.schoolCost),
        chargedValue: input.chargedValue == null ? null : decimal(input.chargedValue),
        supplier: input.supplier,
        quantity: input.quantity,
        notes: input.notes,
      },
    });

    if (input.schoolCost && input.schoolCost > 0) {
      await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'COST',
          category: 'Figurino',
          description: `Custo de figurino - ${input.name}`,
          supplier: input.supplier,
          originType: 'COSTUME',
          originId: costume.id,
          expectedAmount: decimal(input.schoolCost * input.quantity),
          status: 'PENDING',
          createdByUserId: ctx.userId,
        },
      });
    }

    if (!event.hasCostumes) {
      await tx.schoolEvent.update({ where: { id: event.id }, data: { hasCostumes: true } });
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costume.create',
      entityType: 'EventCostume',
      entityId: costume.id,
      eventId: input.eventId,
      after: costume,
    });

    return getCostumeDto(tx, ctx.contaId, costume.id);
  });
}

export async function updateCostume(ctx: EventsContext, costumeId: string, input: UpdateCostumeInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventCostume.findFirst({
      where: { id: costumeId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!current) throw new EventsError('FIGURINO_NAO_ENCONTRADO', 'Figurino não encontrado.', 404);
    assertFinancialAdjustmentEvent(current.event.status);

    const updated = await tx.eventCostume.update({
      where: { id: costumeId },
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        size: input.size,
        color: input.color,
        accessories: input.accessories,
        schoolCost: input.schoolCost === null ? null : (input.schoolCost === undefined ? undefined : decimal(input.schoolCost)),
        chargedValue: input.chargedValue === null ? null : (input.chargedValue === undefined ? undefined : decimal(input.chargedValue)),
        supplier: input.supplier,
        quantity: input.quantity,
        notes: input.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costume.update',
      entityType: 'EventCostume',
      entityId: costumeId,
      eventId: current.eventId,
      before: current,
      after: updated,
    });

    return getCostumeDto(tx, ctx.contaId, costumeId);
  });
}

export function mapCostumeAssignment(
  assignment: Prisma.EventCostumeAssignmentGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      costume: { select: { id: true; name: true; category: true; size: true } };
      aluno: { select: { id: true; nome: true } };
      turma: { select: { id: true; nome: true } };
    };
  }>,
) {
  return {
    id: assignment.id,
    contaId: assignment.contaId,
    eventId: assignment.eventId,
    event: { ...assignment.event, startsAt: assignment.event.startsAt.toISOString() },
    costumeId: assignment.costumeId,
    costume: assignment.costume,
    aluno: assignment.aluno,
    turma: assignment.turma,
    definedSize: assignment.definedSize,
    status: assignment.status,
    chargedValue: assignment.chargedValue == null ? null : toMoney(assignment.chargedValue),
    isPaid: assignment.isPaid,
    billingMode: assignment.billingMode,
    deliveredAt: toIso(assignment.deliveredAt),
    returnedAt: toIso(assignment.returnedAt),
    notes: assignment.notes,
    revenueEntryId: assignment.revenueEntryId,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

export async function listCostumeAssignments(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string } = {}) {
  const assignments = await prisma.eventCostumeAssignment.findMany({
    where: { contaId: ctx.contaId, ...(input.eventId ? { eventId: input.eventId } : {}) },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      costume: { select: { id: true, name: true, category: true, size: true } },
      aluno: { select: { id: true, nome: true } },
      turma: { select: { id: true, nome: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return assignments.map(mapCostumeAssignment);
}

async function getCostumeAssignmentDto(db: DbClient, contaId: string, assignmentId: string) {
  const assignment = await db.eventCostumeAssignment.findFirst({
    where: { id: assignmentId, contaId },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      costume: { select: { id: true, name: true, category: true, size: true } },
      aluno: { select: { id: true, nome: true } },
      turma: { select: { id: true, nome: true } },
    },
  });
  if (!assignment) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino não encontrado.', 404);
  return mapCostumeAssignment(assignment);
}

export async function createCostumeAssignment(ctx: EventsContext, input: CreateCostumeAssignmentInput) {
  return prisma.$transaction(async (tx) => {
    const costume = await tx.eventCostume.findFirst({
      where: { id: input.costumeId, contaId: ctx.contaId, eventId: input.eventId },
      include: { event: true },
    });
    if (!costume) throw new EventsError('FIGURINO_NAO_ENCONTRADO', 'Figurino não encontrado.', 404);
    assertOperationalEvent(costume.event.status);

    const activeAssignmentsCount = await tx.eventCostumeAssignment.count({
      where: {
        costumeId: input.costumeId,
        contaId: ctx.contaId,
        status: { not: 'CANCELLED' }
      }
    });

    if (input.status !== 'CANCELLED' && activeAssignmentsCount >= costume.quantity) {
      throw new EventsError('ESTOQUE_INSUFICIENTE', `Estoque insuficiente para o figurino "${costume.name}". (Disponível: ${costume.quantity}, Reservado: ${activeAssignmentsCount})`, 400);
    }

    if (input.status === 'DELIVERED' && !input.alunoId) {
      throw new EventsError('ALUNO_OBRIGATORIO', 'Informe o aluno antes de marcar entrega.', 422);
    }
    if (input.returnedAt && !input.deliveredAt) {
      throw new EventsError('DEVOLUCAO_INVALIDA', 'Não é possível devolver antes da entrega.', 422);
    }

    const billingMode = input.billingMode ?? 'SEPARATE_CHARGE';
    const chargedValue =
      billingMode === 'FREE'
        ? 0
        : toMoney(input.chargedValue == null ? costume.chargedValue : input.chargedValue);
    if (billingMode === 'SEPARATE_CHARGE' && chargedValue <= 0) {
      throw new EventsError('VALOR_OBRIGATORIO', 'Informe um valor maior que zero para cobrança separada.', 422);
    }

    const assignment = await tx.eventCostumeAssignment.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        costumeId: input.costumeId,
        alunoId: input.alunoId,
        turmaId: input.turmaId,
        definedSize: input.definedSize,
        status: input.status,
        billingMode,
        chargedValue: billingMode === 'FREE' ? null : decimal(chargedValue),
        isPaid: billingMode === 'SEPARATE_CHARGE' ? input.isPaid : false,
        deliveredAt: input.deliveredAt,
        returnedAt: input.returnedAt,
        deliveredByUserId: input.status === 'DELIVERED' ? ctx.userId : null,
        notes: input.notes,
      },
    });

    if (billingMode === 'SEPARATE_CHARGE' && chargedValue > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'REVENUE',
          category: 'Figurino',
          description: costume.name,
          originType: 'COSTUME_ASSIGNMENT',
          originId: assignment.id,
          expectedAmount: decimal(chargedValue),
          actualAmount: input.isPaid ? decimal(chargedValue) : null,
          status: input.isPaid ? 'RECEIVED' : 'PENDING',
          realizedAt: input.isPaid ? new Date() : null,
          createdByUserId: ctx.userId,
        },
      });
      await tx.eventCostumeAssignment.update({ where: { id: assignment.id }, data: { revenueEntryId: entry.id } });
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costumeAssignment.create',
      entityType: 'EventCostumeAssignment',
      entityId: assignment.id,
      eventId: input.eventId,
      after: assignment,
    });

    return getCostumeAssignmentDto(tx, ctx.contaId, assignment.id);
  });
}

export async function updateCostumeAssignment(ctx: EventsContext, assignmentId: string, input: UpdateCostumeAssignmentInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventCostumeAssignment.findFirst({
      where: { id: assignmentId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!current) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino não encontrado.', 404);
    assertOperationalEvent(current.event.status);

    if (input.status) {
      const transition = validateCostumeAssignmentStatusTransition(current.status, input.status);
      if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);
      if (input.status === 'CANCELLED' && current.billingMode === 'SEPARATE_CHARGE' && current.isPaid && current.revenueEntryId) {
        throw new EventsError(
          'DESVINCULO_BLOQUEADO_PAGO',
          'Não é possível desvincular um figurino pago. Estorne ou ajuste o pagamento antes de desvincular.',
          400,
        );
      }
      if (input.status === 'DELIVERED' && !current.alunoId) {
        throw new EventsError('ALUNO_OBRIGATORIO', 'Informe o aluno antes de marcar entrega.', 422);
      }
    }

    const targetCostumeId = (input.costumeId as string) ?? current.costumeId;
    const willBeActive = input.status ? input.status !== 'CANCELLED' : current.status !== 'CANCELLED';
    const wasActive = current.status !== 'CANCELLED';
    const isAddingNewActiveReservation = (willBeActive && !wasActive) || (willBeActive && wasActive && input.costumeId && input.costumeId !== current.costumeId);

    if (isAddingNewActiveReservation) {
      const costume = await tx.eventCostume.findFirst({
        where: { id: targetCostumeId, contaId: ctx.contaId },
      });
      if (!costume) throw new EventsError('FIGURINO_NAO_ENCONTRADO', 'Figurino não encontrado.', 404);

      const activeAssignmentsCount = await tx.eventCostumeAssignment.count({
        where: {
          costumeId: targetCostumeId,
          contaId: ctx.contaId,
          status: { not: 'CANCELLED' }
        }
      });

      if (activeAssignmentsCount >= costume.quantity) {
        throw new EventsError('ESTOQUE_INSUFICIENTE', `Estoque insuficiente para o figurino "${costume.name}". (Disponível: ${costume.quantity}, Reservado: ${activeAssignmentsCount})`, 400);
      }
    }

    const now = new Date();
    let deliveredAt: Date | null | undefined = input.deliveredAt;
    let returnedAt: Date | null | undefined = input.returnedAt;
    let deliveredByUserId: string | null | undefined = undefined;

    if (input.status) {
      if (input.status === 'DELIVERED') {
        deliveredAt = input.deliveredAt ?? current.deliveredAt ?? now;
        returnedAt = null;
        deliveredByUserId = ctx.userId;
      } else if (input.status === 'RETURNED') {
        deliveredAt = input.deliveredAt ?? current.deliveredAt ?? now;
        returnedAt = input.returnedAt ?? current.returnedAt ?? now;
        deliveredByUserId = current.deliveredByUserId ?? ctx.userId;
      } else {
        deliveredAt = null;
        returnedAt = null;
        deliveredByUserId = null;
      }
    }

    const targetBillingMode = input.billingMode ?? current.billingMode;
    const targetChargedValue =
      targetBillingMode === 'FREE'
        ? 0
        : toMoney(input.chargedValue == null ? current.chargedValue : input.chargedValue);
    if (targetBillingMode === 'SEPARATE_CHARGE' && targetChargedValue <= 0) {
      throw new EventsError('VALOR_OBRIGATORIO', 'Informe um valor maior que zero para cobrança separada.', 422);
    }
    const targetIsPaid = targetBillingMode === 'SEPARATE_CHARGE'
      ? (input.isPaid ?? current.isPaid)
      : false;

    const updated = await tx.eventCostumeAssignment.update({
      where: { id: assignmentId },
      data: {
        costumeId: input.costumeId,
        alunoId: input.alunoId,
        turmaId: input.turmaId,
        status: input.status,
        billingMode: targetBillingMode,
        definedSize: input.definedSize,
        chargedValue: targetBillingMode === 'FREE' ? null : decimal(targetChargedValue),
        isPaid: targetIsPaid,
        deliveredAt,
        returnedAt,
        deliveredByUserId,
        notes: input.notes,
      },
    });

    const chargedValue = toMoney(updated.chargedValue);
    if (updated.billingMode !== 'SEPARATE_CHARGE') {
      if (updated.revenueEntryId) {
        await tx.eventFinancialEntry.deleteMany({
          where: { contaId: ctx.contaId, id: updated.revenueEntryId, originType: 'COSTUME_ASSIGNMENT' },
        });
        await tx.eventCostumeAssignment.update({
          where: { id: assignmentId },
          data: { revenueEntryId: null },
        });
      }
    } else if (updated.revenueEntryId) {
      const targetCostume = await tx.eventCostume.findFirst({
        where: { id: updated.costumeId, contaId: ctx.contaId },
      });

      if (chargedValue > 0) {
        await tx.eventFinancialEntry.updateMany({
          where: { contaId: ctx.contaId, id: updated.revenueEntryId, originType: 'COSTUME_ASSIGNMENT' },
          data: {
            description: targetCostume?.name ?? undefined,
            expectedAmount: decimal(chargedValue),
            actualAmount: targetIsPaid ? decimal(chargedValue) : null,
            status: targetIsPaid ? 'RECEIVED' : 'PENDING',
            realizedAt: targetIsPaid ? now : null,
          },
        });
      } else {
        await tx.eventFinancialEntry.deleteMany({
          where: { contaId: ctx.contaId, id: updated.revenueEntryId, originType: 'COSTUME_ASSIGNMENT' },
        });
        await tx.eventCostumeAssignment.update({
          where: { id: assignmentId },
          data: { revenueEntryId: null },
        });
      }
    } else if (chargedValue > 0) {
      const targetCostume = await tx.eventCostume.findFirst({
        where: { id: updated.costumeId, contaId: ctx.contaId },
      });
      if (targetCostume) {
        const entry = await tx.eventFinancialEntry.create({
          data: {
            contaId: ctx.contaId,
            eventId: updated.eventId,
            type: 'REVENUE',
            category: 'Figurino',
            description: targetCostume.name,
            originType: 'COSTUME_ASSIGNMENT',
            originId: updated.id,
            expectedAmount: decimal(chargedValue),
            actualAmount: targetIsPaid ? decimal(chargedValue) : null,
            status: targetIsPaid ? 'RECEIVED' : 'PENDING',
            realizedAt: targetIsPaid ? now : null,
            createdByUserId: ctx.userId,
          },
        });
        await tx.eventCostumeAssignment.update({
          where: { id: updated.id },
          data: { revenueEntryId: entry.id },
        });
      }
    }

    const lossOriginId = `loss:${updated.id}`;
    if (updated.status === 'DAMAGED' || updated.status === 'LOST') {
      const targetCostume = await tx.eventCostume.findFirst({
        where: { id: updated.costumeId, contaId: ctx.contaId },
      });
      const lossAmount = toMoney(targetCostume?.schoolCost) || toMoney(updated.chargedValue);
      if (lossAmount > 0) {
        const existingLoss = await tx.eventFinancialEntry.findFirst({
          where: { contaId: ctx.contaId, originType: 'COSTUME', originId: lossOriginId },
        });
        const lossData = {
          type: 'COST' as const,
          category: 'Prejuízo',
          description: `${updated.status === 'DAMAGED' ? 'Figurino danificado' : 'Figurino perdido'} - ${targetCostume?.name ?? 'Figurino'}`,
          supplier: targetCostume?.supplier ?? null,
          expectedAmount: decimal(lossAmount),
          actualAmount: decimal(lossAmount),
          status: 'PAID' as const,
          realizedAt: now,
          notes: updated.notes,
        };
        if (existingLoss) {
          await tx.eventFinancialEntry.update({
            where: { id: existingLoss.id },
            data: lossData,
          });
        } else {
          await tx.eventFinancialEntry.create({
            data: {
              contaId: ctx.contaId,
              eventId: updated.eventId,
              originType: 'COSTUME',
              originId: lossOriginId,
              createdByUserId: ctx.userId,
              ...lossData,
            },
          });
        }
      }
    } else {
      await tx.eventFinancialEntry.updateMany({
        where: {
          contaId: ctx.contaId,
          originType: 'COSTUME',
          originId: lossOriginId,
          status: { not: 'CANCELLED' },
        },
        data: {
          status: 'CANCELLED',
          actualAmount: null,
          realizedAt: null,
          notes: `Prejuízo cancelado porque o figurino voltou para ${updated.status}.`,
        },
      });
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costumeAssignment.update',
      entityType: 'EventCostumeAssignment',
      entityId: assignmentId,
      eventId: current.eventId,
      before: current,
      after: updated,
    });

    return getCostumeAssignmentDto(tx, ctx.contaId, assignmentId);
  });
}

export function mapFinancialEntry(
  entry: Prisma.EventFinancialEntryGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      createdBy: { select: { id: true; nome: true } };
    };
  }>,
) {
  return {
    id: entry.id,
    contaId: entry.contaId,
    eventId: entry.eventId,
    event: { ...entry.event, startsAt: entry.event.startsAt.toISOString() },
    type: entry.type,
    category: entry.category,
    description: entry.description,
    supplier: entry.supplier,
    originType: entry.originType,
    originId: entry.originId,
    expectedAmount: toMoney(entry.expectedAmount),
    actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
    refundedAmount: entry.refundedAmount == null ? 0 : toMoney(entry.refundedAmount),
    netAmount: entry.netAmount == null ? null : toMoney(entry.netAmount),
    dueDate: toIso(entry.dueDate),
    realizedAt: toIso(entry.realizedAt),
    status: entry.status,
    paymentMethod: entry.paymentMethod,
    proofUrl: entry.proofUrl,
    notes: entry.notes,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export async function listFinancialEntries(
  ctx: Pick<EventsContext, 'contaId'>,
  input: { eventId?: string; type?: 'COST' | 'REVENUE' } = {},
) {
  const entries = await prisma.eventFinancialEntry.findMany({
    where: {
      contaId: ctx.contaId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.type ? { type: input.type } : {}),
    },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      createdBy: { select: { id: true, nome: true } },
    },
    orderBy: [{ realizedAt: 'desc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
  });
  return entries.map(mapFinancialEntry);
}

async function getFinancialEntryDto(db: DbClient, contaId: string, entryId: string) {
  const entry = await db.eventFinancialEntry.findFirst({
    where: { id: entryId, contaId },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      createdBy: { select: { id: true, nome: true } },
    },
  });
  if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
  return mapFinancialEntry(entry);
}

export async function createFinancialEntry(ctx: EventsContext, input: CreateEventFinancialEntryInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertFinancialAdjustmentEvent(event.status);

    const actualAmount = input.actualAmount == null ? null : decimal(input.actualAmount);
    const refundedAmount = input.refundedAmount == null ? decimal(0) : decimal(input.refundedAmount);
    const netAmount = input.actualAmount == null ? null : decimal(Math.max(input.actualAmount - (input.refundedAmount ?? 0), 0));
    const entry = await tx.eventFinancialEntry.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        type: input.type,
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        originType: 'MANUAL',
        expectedAmount: decimal(input.expectedAmount),
        actualAmount,
        refundedAmount,
        netAmount,
        dueDate: input.dueDate,
        realizedAt: input.realizedAt,
        status: input.status,
        paymentMethod: input.paymentMethod,
        proofUrl: input.proofUrl,
        notes: input.notes,
        createdByUserId: ctx.userId,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: input.type === 'COST' ? 'events.finance.cost.create' : 'events.finance.revenue.create',
      entityType: 'EventFinancialEntry',
      entityId: entry.id,
      eventId: input.eventId,
      after: entry,
    });

    return getFinancialEntryDto(tx, ctx.contaId, entry.id);
  });
}

export async function updateFinancialEntry(ctx: EventsContext, entryId: string, input: UpdateEventFinancialEntryInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventFinancialEntry.findFirst({
      where: { id: entryId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!current) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (current.originType !== 'MANUAL') {
      throw new EventsError(
        'LANCAMENTO_AUTOMATICO',
        'Lançamentos automáticos devem ser alterados pela venda ou figurino de origem.',
        409,
      );
    }
    assertFinancialAdjustmentEvent(current.event.status);

    const actualAmount = input.actualAmount == null ? undefined : decimal(input.actualAmount);
    const refundedAmount = input.refundedAmount == null ? undefined : decimal(input.refundedAmount);
    const nextActual = input.actualAmount ?? toMoney(current.actualAmount);
    const nextRefunded = input.refundedAmount ?? toMoney(current.refundedAmount);
    const netAmount = input.actualAmount == null && input.refundedAmount == null
      ? undefined
      : decimal(Math.max(nextActual - nextRefunded, 0));

    const updated = await tx.eventFinancialEntry.update({
      where: { id: entryId },
      data: {
        type: input.type,
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        expectedAmount: input.expectedAmount == null ? undefined : decimal(input.expectedAmount),
        actualAmount,
        refundedAmount,
        netAmount,
        dueDate: input.dueDate,
        realizedAt: input.realizedAt,
        status: input.status,
        paymentMethod: input.paymentMethod,
        proofUrl: input.proofUrl,
        notes: input.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.finance.entry.update',
      entityType: 'EventFinancialEntry',
      entityId: entryId,
      eventId: current.eventId,
      before: current,
      after: updated,
    });

    return getFinancialEntryDto(tx, ctx.contaId, entryId);
  });
}

export async function listEventAudit(ctx: Pick<EventsContext, 'contaId'>, eventId: string, limit = 50) {
  const logs = await prisma.eventAudit.findMany({
    where: { contaId: ctx.contaId, eventId },
    include: { actor: { select: { id: true, nome: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actor: log.actor,
    before: log.before,
    after: log.after,
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
  }));
}

export async function getEventReports(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string; compareWithEventId?: string } = {}) {
  const events = await prisma.schoolEvent.findMany({
    where: { contaId: ctx.contaId },
    include: eventInclude,
    orderBy: { startsAt: 'desc' },
  });
  const paymentSnapshots = await buildParticipantPaymentSnapshots(ctx, events);
  const mapped = events.map((event) => mapSchoolEvent(event, paymentSnapshots));
  const selected = input.eventId ? mapped.find((event) => event.id === input.eventId) ?? null : mapped[0] ?? null;
  const compareWith = input.compareWithEventId
    ? mapped.find((event) => event.id === input.compareWithEventId) ?? null
    : null;

  const total = mapped.reduce(
    (acc, event) => {
      acc.receita += event.metrics.receitaRealizada;
      acc.custo += event.metrics.custoRealizado;
      acc.resultado += event.metrics.resultadoRealizado;
      acc.ingressos += event.metrics.ingressosVendidos;
      if (event.metrics.resultadoRealizado >= 0) acc.lucrativos += 1;
      if (event.metrics.resultadoRealizado < 0) acc.prejuizo += 1;
      return acc;
    },
    { receita: 0, custo: 0, resultado: 0, ingressos: 0, lucrativos: 0, prejuizo: 0 },
  );

  const ranking = [...mapped]
    .sort((a, b) => b.metrics.resultadoRealizado - a.metrics.resultadoRealizado)
    .slice(0, 10);

  return {
    general: {
      ...total,
      margemMedia: total.receita > 0 ? total.resultado / total.receita : null,
      ticketMedio: total.ingressos > 0 ? total.receita / total.ingressos : null,
      ranking,
    },
    selected,
    compareWith,
    events: mapped.map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: event.startsAt,
      status: event.status,
      type: event.type,
      metrics: event.metrics,
    })),
  };
}

type ParticipantLifecycleRecord = Prisma.EventParticipantGetPayload<{
  include: {
    aluno: { select: { email: true } };
    responsavel: { select: { email: true } };
  };
}>;

function normalizeParticipantEmails(participant: ParticipantLifecycleRecord) {
  return [...new Set([
    participant.aluno?.email?.trim().toLowerCase(),
    participant.responsavel?.email?.trim().toLowerCase(),
  ].filter((email): email is string => Boolean(email)))];
}

async function collectChargesForEntries(
  db: DbClient,
  ctx: Pick<EventsContext, 'contaId'>,
  entries: Prisma.EventFinancialEntryGetPayload<{}>[],
) {
  const asaasPaymentIds = entries
    .map((entry) => entry.asaasPaymentId)
    .filter((id): id is string => Boolean(id));

  if (asaasPaymentIds.length === 0) return [];

  const [plans, directCharges] = await Promise.all([
    db.standaloneInstallmentPlan.findMany({
      where: { contaId: ctx.contaId, asaasInstallmentId: { in: asaasPaymentIds } },
      include: { charges: true },
    }),
    db.charge.findMany({
      where: { contaId: ctx.contaId, asaasPaymentId: { in: asaasPaymentIds } },
    }),
  ]);

  const planIds = Array.from(new Set([
    ...plans.map((plan) => plan.id),
    ...directCharges
      .map((charge) => charge.standaloneInstallmentPlanId)
      .filter((id): id is string => Boolean(id)),
  ]));

  const planCharges = planIds.length > 0
    ? await db.charge.findMany({
        where: { contaId: ctx.contaId, standaloneInstallmentPlanId: { in: planIds } },
      })
    : [];

  const seen = new Set<string>();
  return [
    ...directCharges,
    ...plans.flatMap((plan) => plan.charges),
    ...planCharges,
  ].filter((charge) => {
    if (seen.has(charge.id)) return false;
    seen.add(charge.id);
    return true;
  });
}

async function buildEventParticipantRemovalDecision(
  db: DbClient,
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  participant: ParticipantLifecycleRecord,
): Promise<EventParticipantRemovalDecision> {
  const financialEntries = participant.revenueEntryId
    ? await db.eventFinancialEntry.findMany({
        where: { contaId: ctx.contaId, eventId, id: participant.revenueEntryId },
      })
    : [];
  const charges = await collectChargesForEntries(db, ctx, financialEntries);

  const ticketOwnerFilters = [
    participant.alunoId ? { alunoId: participant.alunoId } : null,
    participant.responsavelId ? { responsavelId: participant.responsavelId } : null,
  ].filter((filter): filter is { alunoId: string } | { responsavelId: string } => Boolean(filter));

  const costumeOwnerFilters = [
    participant.alunoId ? { alunoId: participant.alunoId } : null,
    participant.turmaId ? { turmaId: participant.turmaId } : null,
  ].filter((filter): filter is { alunoId: string } | { turmaId: string } => Boolean(filter));

  const buyerEmails = normalizeParticipantEmails(participant);

  const [ticketSales, costumeAssignments, publicOrders] = await Promise.all([
    ticketOwnerFilters.length > 0
      ? db.eventTicketSale.findMany({
          where: {
            contaId: ctx.contaId,
            eventId,
            OR: ticketOwnerFilters,
          },
          select: { status: true },
        })
      : Promise.resolve([]),
    costumeOwnerFilters.length > 0
      ? db.eventCostumeAssignment.findMany({
          where: {
            contaId: ctx.contaId,
            eventId,
            OR: costumeOwnerFilters,
          },
          select: { status: true, isPaid: true },
        })
      : Promise.resolve([]),
    buyerEmails.length > 0
      ? db.eventMapOrder.findMany({
          where: {
            contaId: ctx.contaId,
            eventId,
            OR: buyerEmails.map((email) => ({ buyerEmail: { equals: email, mode: 'insensitive' } })),
          },
          select: {
            status: true,
            refundedAmount: true,
            items: {
              select: {
                ticket: {
                  select: { id: true, status: true },
                },
              },
            },
            tickets: {
              select: { id: true, status: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const facts: EventParticipantRemovalFacts = {
    cancelledAt: participant.cancelledAt,
    isFeePaid: participant.isFeePaid,
    feePaidAmount: toMoney(participant.feePaidAmount),
    feeRefundedAmount: toMoney(participant.feeRefundedAmount),
    financialEntries: financialEntries.map((entry) => ({
      status: entry.status,
      actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
      refundedAmount: entry.refundedAmount == null ? null : toMoney(entry.refundedAmount),
      netAmount: entry.netAmount == null ? null : toMoney(entry.netAmount),
    })),
    charges: charges.map((charge) => ({ status: charge.status })),
    ticketSales: ticketSales.map((sale) => ({ status: sale.status })),
    costumeAssignments: costumeAssignments.map((assignment) => ({
      status: assignment.status,
      isPaid: assignment.isPaid,
    })),
    publicOrders: publicOrders.map((order) => ({
      status: order.status,
      refundedAmount: toMoney(order.refundedAmount),
      itemsCount: order.items.length,
      ticketsCount: order.tickets.length,
    })),
    tickets: publicOrders.flatMap((order) => [
      ...order.tickets.map((ticket) => ({ status: ticket.status })),
      ...order.items.flatMap((item) => (item.ticket ? [{ status: item.ticket.status }] : [])),
    ]),
  };

  return canRemoveEventParticipant(facts);
}

export async function getEventParticipantRemovalDecision(
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  participantId: string,
) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    include: {
      aluno: { select: { email: true } },
      responsavel: { select: { email: true } },
    },
  });

  if (!participant) {
    throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
  }

  return buildEventParticipantRemovalDecision(prisma, ctx, eventId, participant);
}

export async function registerEventParticipant(ctx: EventsContext, input: CreateEventParticipantInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({
      where: { id: input.eventId, contaId: ctx.contaId },
    });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertOperationalEvent(event.status);

    const existing = await tx.eventParticipant.findFirst({
      where: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        alunoId: input.alunoId,
      },
      include: {
        aluno: { select: { email: true } },
        responsavel: { select: { email: true } },
      },
    });
    if (existing) {
      if (!existing.cancelledAt) {
        throw new EventsError(
          'PARTICIPANTE_JA_INSCRITO',
          'Este aluno já está inscrito neste evento.',
          409,
        );
      }

      const decision = await buildEventParticipantRemovalDecision(tx, ctx, input.eventId, existing);
      throw new EventsError(
        'PARTICIPANTE_CANCELADO_EXISTENTE',
        'Este aluno possui uma inscrição cancelada neste evento. Reative a inscrição para gerar uma nova cobrança.',
        409,
        {
          participantId: existing.id,
          canRemove: decision.canRemove,
          canReactivate: decision.canRemove,
          reasons: decision.canRemove ? [] : decision.reasons,
        },
      );
    }

    const aluno = await tx.aluno.findFirst({
      where: { id: input.alunoId, contaId: ctx.contaId },
    });
    if (!aluno) throw new EventsError('ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado.', 404);

    let revenueEntryId: string | null = null;
    const feeCharged = input.registrationFeeCharged ?? 0;

    if (feeCharged > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: decimal(feeCharged),
          actualAmount: input.isFeePaid ? decimal(feeCharged) : null,
          dueDate: new Date(),
          realizedAt: input.isFeePaid ? new Date() : null,
          status: input.isFeePaid ? 'RECEIVED' : 'PENDING',
          paymentMethod: mapToEventPaymentMethod(input.feePaymentMethod),
          notes: input.notes,
        },
      });
      revenueEntryId = entry.id;
    }

    const participant = await tx.eventParticipant.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        type: 'STUDENT',
        alunoId: input.alunoId,
        displayName: aluno.nome,
        registrationFeeCharged: decimal(feeCharged),
        isFeePaid: input.isFeePaid ?? false,
        feePaymentMethod: input.feePaymentMethod ?? null,
        revenueEntryId,
        notes: input.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.register',
      entityType: 'EventParticipant',
      entityId: participant.id,
      eventId: input.eventId,
      after: participant,
    });

    return participant;
  });
}

export async function unregisterEventParticipant(ctx: EventsContext, eventId: string, participantId: string) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    include: { event: true },
  });
  if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
  assertOperationalEvent(participant.event.status);

  if (participant.cancelledAt) {
    return { ok: true };
  }

  const entry = participant.revenueEntryId
    ? await prisma.eventFinancialEntry.findFirst({
        where: { id: participant.revenueEntryId, contaId: ctx.contaId },
      })
    : null;

  const linkedCharges = entry?.asaasPaymentId
    ? await prisma.charge.findMany({
        where: {
          contaId: ctx.contaId,
          OR: [
            { asaasPaymentId: entry.asaasPaymentId },
            { standaloneInstallmentPlan: { asaasInstallmentId: entry.asaasPaymentId } },
          ],
        },
      })
    : [];

  const openCharges = linkedCharges.filter((charge) =>
    ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'].includes(charge.status),
  );
  if (openCharges.length > 0) {
    const credentials = await loadDecryptedAsaasCredentials(ctx.contaId);
    if (credentials?.apiKey) {
      for (const charge of openCharges) {
        if (!charge.asaasPaymentId) continue;
        await deleteAsaasPayment({ apiKey: credentials.apiKey, paymentId: charge.asaasPaymentId });
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const payment = calculateParticipantPayment(
      participant.registrationFeeCharged.toNumber(),
      participant.isFeePaid,
      entry,
      linkedCharges,
    );

    const updated = await tx.eventParticipant.update({
      where: { id: participantId },
      data: {
        isFeePaid: false,
        financialStatusSnapshot: 'CANCELADO',
        feePaidAmount: decimal(payment.totalPaid),
        feeRefundedAmount: decimal(payment.totalRefunded),
        cancelledAt: new Date(),
      },
    });

    if (openCharges.length > 0) {
      await tx.charge.updateMany({
        where: { contaId: ctx.contaId, id: { in: openCharges.map((charge) => charge.id) } },
        data: { status: 'CANCELED', statusUpdatedAt: new Date() },
      });
    }

    if (entry) {
      const actualAmount = payment.totalPaid > 0 ? decimal(payment.totalPaid) : null;
      await tx.eventFinancialEntry.update({
        where: { id: entry.id },
        data: {
          status: payment.totalPaid > 0 ? 'PENDING' : 'CANCELLED',
          actualAmount,
          refundedAmount: decimal(payment.totalRefunded),
          netAmount: payment.netPaid > 0 ? decimal(payment.netPaid) : null,
          cancelledAt: payment.totalPaid > 0 ? null : new Date(),
          notes: [entry.notes, 'Inscrição cancelada; histórico financeiro preservado.'].filter(Boolean).join('\n'),
        },
      });
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.unregister',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId: participant.eventId,
      before: participant,
      after: updated,
      metadata: {
        cancelledOpenCharges: openCharges.map((charge) => charge.id),
        paidAmount: payment.totalPaid,
        refundedAmount: payment.totalRefunded,
      },
    });

    return { ok: true };
  });
}

export async function removeCancelledEventParticipant(ctx: EventsContext, eventId: string, participantId: string) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    include: {
      event: true,
      aluno: { select: { email: true } },
      responsavel: { select: { email: true } },
    },
  });
  if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
  assertOperationalEvent(participant.event.status);

  const decision = await buildEventParticipantRemovalDecision(prisma, ctx, eventId, participant);
  if (!decision.canRemove) {
    throw new EventsError(
      'PARTICIPANTE_NAO_REMOVIVEL',
      decision.reasons[0] ?? 'Este participante possui histórico e não pode ser removido com segurança.',
      409,
      { reasons: decision.reasons },
    );
  }

  return prisma.$transaction(async (tx) => {
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.remove',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId,
      before: participant,
      after: null,
      metadata: {
        decision,
        reason: 'Inscrição cancelada sem histórico operacional relevante.',
      },
    });

    await tx.eventParticipant.delete({
      where: { id: participantId },
    });

    return { ok: true };
  });
}

export async function reactivateEventParticipant(
  ctx: EventsContext,
  eventId: string,
  participantId: string,
  input: ReactivateEventParticipantInput,
) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: {
        event: true,
        aluno: { select: { email: true } },
        responsavel: { select: { email: true } },
      },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertOperationalEvent(participant.event.status);

    if (!participant.cancelledAt) {
      throw new EventsError(
        'PARTICIPANTE_NAO_CANCELADO',
        'Somente inscrições canceladas podem ser reinscritas.',
        409,
      );
    }

    const decision = await buildEventParticipantRemovalDecision(tx, ctx, eventId, participant);
    if (!decision.canRemove) {
      throw new EventsError(
        'PARTICIPANTE_REINSCRICAO_BLOQUEADA',
        'Este aluno possui histórico financeiro ou operacional neste evento. A reinscrição automática não está disponível para este caso.',
        409,
        { reasons: decision.reasons },
      );
    }

    const before = participant;
    const feeCharged = input.registrationFeeCharged ?? participant.registrationFeeCharged.toNumber();
    const isFeePaid = input.isFeePaid ?? false;
    const dueDate = input.dueDate ?? new Date();
    let revenueEntryId: string | null = null;

    if (feeCharged > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: decimal(feeCharged),
          actualAmount: isFeePaid ? decimal(feeCharged) : null,
          dueDate,
          realizedAt: isFeePaid ? new Date() : null,
          status: isFeePaid ? 'RECEIVED' : 'PENDING',
          paymentMethod: mapToEventPaymentMethod(input.feePaymentMethod),
          notes: input.notes,
          paymentProvider: input.paymentProvider ?? null,
          asaasPaymentId: input.asaasPaymentId ?? null,
          paymentStatus: input.paymentStatus ?? null,
        },
      });
      revenueEntryId = entry.id;
    }

    const updated = await tx.eventParticipant.update({
      where: { id: participantId },
      data: {
        registrationFeeCharged: decimal(feeCharged),
        isFeePaid,
        feePaymentMethod: feeCharged > 0 ? (input.feePaymentMethod ?? null) : null,
        revenueEntryId,
        financialStatusSnapshot: feeCharged <= 0 ? 'ISENTO' : isFeePaid ? 'QUITADO' : 'PENDENTE',
        feePaidAmount: isFeePaid ? decimal(feeCharged) : decimal(0),
        feeRefundedAmount: decimal(0),
        cancelledAt: null,
        cancelledReason: null,
        notes: input.notes ?? participant.notes,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.reactivate',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId,
      before,
      after: updated,
      metadata: {
        billingMethod: input.billingMethod,
        chargeType: input.chargeType,
        installmentCount: input.installmentCount,
        previousRevenueEntryId: before.revenueEntryId,
        newRevenueEntryId: revenueEntryId,
      },
    });

    return updated;
  });
}

export async function quitarEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string, input: QuitarParticipantFeeInput) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertOperationalEvent(participant.event.status);

    if (participant.isFeePaid) {
      throw new EventsError('TAXA_JA_PAGA', 'A taxa de inscrição deste aluno já está paga.', 409);
    }

    const value = participant.registrationFeeCharged.toNumber();
    if (value <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Esta inscrição não possui valor a ser cobrado.', 400);
    }

    let revenueEntryId = participant.revenueEntryId;
    if (revenueEntryId) {
      await tx.eventFinancialEntry.update({
        where: { id: revenueEntryId },
        data: {
          status: 'RECEIVED',
          actualAmount: decimal(value),
          realizedAt: new Date(),
          paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        },
      });
    } else {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: participant.eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: decimal(value),
          actualAmount: decimal(value),
          dueDate: new Date(),
          realizedAt: new Date(),
          status: 'RECEIVED',
          paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        },
      });
      revenueEntryId = entry.id;
    }

    const updated = await tx.eventParticipant.update({
      where: { id: participantId },
      data: {
        isFeePaid: true,
        feePaymentMethod: input.paymentMethod,
        revenueEntryId,
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.quitar',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId: participant.eventId,
      before: participant,
      after: updated,
    });

    return updated;
  });
}

export async function refundManualEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertOperationalEvent(participant.event.status);
    if (!participant.revenueEntryId) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'A inscrição não possui lançamento financeiro vinculado.', 404);
    }

    const entry = await tx.eventFinancialEntry.findFirst({
      where: { id: participant.revenueEntryId, contaId: ctx.contaId },
    });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') {
      throw new EventsError('ESTORNO_ASAAS_BLOQUEADO', 'Use o fluxo de estorno do Asaas para cobranças intermediadas.', 409);
    }
    if (!['RECEIVED', 'PAID'].includes(entry.status)) {
      throw new EventsError('ESTORNO_BLOQUEADO', 'Somente taxas manuais pagas podem ser estornadas.', 400);
    }

    const refundableAmount = toNumber(entry.actualAmount ?? participant.registrationFeeCharged);
    if (refundableAmount <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Não há valor pago para estornar.', 400);
    }

    const updatedEntry = await tx.eventFinancialEntry.update({
      where: { id: entry.id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundedAmount: decimal(refundableAmount),
        netAmount: decimal(0),
      },
    });

    const updatedParticipant = await tx.eventParticipant.update({
      where: { id: participant.id },
      data: {
        isFeePaid: false,
        feeRefundedAmount: decimal(refundableAmount),
        feePaidAmount: decimal(0),
        financialStatusSnapshot: 'ESTORNADO',
      },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.fee.refund',
      entityType: 'EventFinancialEntry',
      entityId: entry.id,
      eventId: participant.eventId,
      before: { participant, entry },
      after: { participant: updatedParticipant, entry: updatedEntry },
    });

    return { success: true };
  });
}

export async function deleteManualEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertOperationalEvent(participant.event.status);
    if (!participant.revenueEntryId) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'A inscrição não possui lançamento financeiro vinculado.', 404);
    }

    const entry = await tx.eventFinancialEntry.findFirst({
      where: { id: participant.revenueEntryId, contaId: ctx.contaId },
    });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') {
      throw new EventsError('EXCLUSAO_ASAAS_BLOQUEADA', 'Não é possível excluir cobrança intermediada pelo Asaas.', 409);
    }
    if (participant.isFeePaid || entry.actualAmount || ['RECEIVED', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(entry.status)) {
      throw new EventsError('EXCLUSAO_BLOQUEADA', 'Não é possível excluir taxa paga ou estornada. Use estorno para preservar o histórico.', 400);
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.fee.delete',
      entityType: 'EventFinancialEntry',
      entityId: entry.id,
      eventId: participant.eventId,
      before: { participant, entry },
      after: null,
    });

    await tx.eventParticipant.update({
      where: { id: participant.id },
      data: {
        revenueEntryId: null,
        isFeePaid: false,
        financialStatusSnapshot: null,
      },
    });

    await tx.eventFinancialEntry.delete({
      where: { id: entry.id },
    });

    return { success: true };
  });
}

export function calculateParticipantPayment(
  registrationFeeCharged: number,
  isFeePaid: boolean,
  entry: any,
  charges: any[]
) {
  const resolution = resolveEventParticipantPayment({
    expectedAmount: registrationFeeCharged,
    paidFallback: isFeePaid,
    cancelled: entry?.status === 'CANCELLED',
    refunded: entry?.status === 'REFUNDED',
    charges,
  });

  return {
    percentPaid: resolution.percentPaid,
    status: resolution.status,
    totalPaid: resolution.paidAmount,
    totalRefunded: resolution.refundedAmount,
    netPaid: resolution.netPaidAmount,
  };
}

async function buildParticipantPaymentSnapshots(
  ctx: Pick<EventsContext, 'contaId'>,
  records: Pick<SchoolEventRecord, 'participants' | 'financialEntries'>[],
): Promise<Map<string, ParticipantPaymentSnapshot>> {
  const participants = records.flatMap((record) => record.participants);
  const entryById = new Map(records.flatMap((record) => record.financialEntries.map((entry) => [entry.id, entry])));
  const feeParticipants = participants.filter((participant) => participant.revenueEntryId);
  const asaasPaymentIds = feeParticipants
    .map((participant) => entryById.get(participant.revenueEntryId ?? '')?.asaasPaymentId)
    .filter((id): id is string => Boolean(id));

  const snapshots = new Map<string, ParticipantPaymentSnapshot>();
  if (feeParticipants.length === 0) return snapshots;

  let plans: any[] = [];
  let directCharges: any[] = [];
  let planCharges: any[] = [];

  if (asaasPaymentIds.length > 0) {
    plans = await prisma.standaloneInstallmentPlan.findMany({
      where: { contaId: ctx.contaId, asaasInstallmentId: { in: asaasPaymentIds } },
      include: { charges: true },
    });

    directCharges = await prisma.charge.findMany({
      where: { contaId: ctx.contaId, asaasPaymentId: { in: asaasPaymentIds } },
    });

    const planIds = Array.from(new Set([
      ...directCharges.map((charge) => charge.standaloneInstallmentPlanId).filter((id): id is string => Boolean(id)),
      ...plans.map((plan) => plan.id),
    ]));

    if (planIds.length > 0) {
      planCharges = await prisma.charge.findMany({
        where: { contaId: ctx.contaId, standaloneInstallmentPlanId: { in: planIds } },
      });
    }
  }

  for (const participant of feeParticipants) {
    const entry = entryById.get(participant.revenueEntryId ?? '');
    if (!entry) continue;

    const asaasPaymentId = entry.asaasPaymentId;
    let participantCharges: any[] = [];

    if (asaasPaymentId) {
      const direct = directCharges.filter((charge) => charge.asaasPaymentId === asaasPaymentId);
      const directPlanIds = direct
        .map((charge) => charge.standaloneInstallmentPlanId)
        .filter((id): id is string => Boolean(id));
      const paymentPlans = plans.filter((plan) => plan.asaasInstallmentId === asaasPaymentId);
      const paymentPlanIds = paymentPlans.map((plan) => plan.id);
      const referencedPlanIds = Array.from(new Set([...directPlanIds, ...paymentPlanIds]));

      const seen = new Set<string>();
      participantCharges = [
        ...direct,
        ...paymentPlans.flatMap((plan) => plan.charges),
        ...planCharges.filter((charge) => charge.standaloneInstallmentPlanId && referencedPlanIds.includes(charge.standaloneInstallmentPlanId)),
      ].filter((charge) => {
        if (seen.has(charge.id)) return false;
        seen.add(charge.id);
        return true;
      });
    }

    const payment = calculateParticipantPayment(
      participant.registrationFeeCharged.toNumber(),
      participant.isFeePaid,
      entry,
      participantCharges,
    );
    const realizedAt = participantCharges
      .filter((charge) => ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'].includes(charge.status))
      .sort((a, b) => b.statusUpdatedAt.getTime() - a.statusUpdatedAt.getTime())[0]?.statusUpdatedAt ?? null;

    snapshots.set(participant.revenueEntryId ?? '', {
      percentPaid: payment.percentPaid,
      financialStatus: payment.status,
      totalPaid: payment.totalPaid,
      totalRefunded: payment.totalRefunded,
      netPaid: payment.netPaid,
      realizedAt,
      entryStatus: financialEntryStatusFromParticipantStatus(payment.status),
    });
  }

  return snapshots;
}

export async function listEventParticipants(ctx: Pick<EventsContext, 'contaId'>, eventId: string) {
  const participants = await prisma.eventParticipant.findMany({
    where: { contaId: ctx.contaId, eventId },
    include: {
      aluno: { select: { id: true, nome: true, foto: true, email: true } },
      responsavel: { select: { email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const revenueEntryIds = participants
    .map((p) => p.revenueEntryId)
    .filter((id): id is string => Boolean(id));

  const financialEntries = revenueEntryIds.length > 0
    ? await prisma.eventFinancialEntry.findMany({
        where: { contaId: ctx.contaId, id: { in: revenueEntryIds } },
      })
    : [];

  const asaasPaymentIds = financialEntries
    .map((e) => e.asaasPaymentId)
    .filter((id): id is string => Boolean(id));

  let plans: any[] = [];
  let directCharges: any[] = [];
  let planCharges: any[] = [];

  if (asaasPaymentIds.length > 0) {
    plans = await prisma.standaloneInstallmentPlan.findMany({
      where: { contaId: ctx.contaId, asaasInstallmentId: { in: asaasPaymentIds } },
      include: { charges: true },
    });

    directCharges = await prisma.charge.findMany({
      where: { contaId: ctx.contaId, asaasPaymentId: { in: asaasPaymentIds } },
    });

    const planIds = directCharges
      .map((c) => c.standaloneInstallmentPlanId)
      .filter((id): id is string => Boolean(id));

    if (planIds.length > 0) {
      planCharges = await prisma.charge.findMany({
        where: { contaId: ctx.contaId, standaloneInstallmentPlanId: { in: planIds } },
      });
    }
  }

  const participantData: any[] = [];
  for (const part of participants) {
    let costumeCount = 0;
    let pendingCostumes = 0;
    let costumesValue = 0;

    if (part.alunoId) {
      const costumes = await prisma.eventCostumeAssignment.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: part.alunoId },
      });
      costumeCount = costumes.length;
      pendingCostumes = costumes.filter((c) => c.status !== 'DELIVERED').length;
      costumesValue = costumes.reduce(
        (sum, c) => sum + (c.billingMode === 'SEPARATE_CHARGE' && c.chargedValue ? c.chargedValue.toNumber() : 0),
        0,
      );
    }

    let ticketsBought = 0;
    let ticketsValue = 0;
    if (part.alunoId) {
      const ticketSales = await prisma.eventTicketSale.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: part.alunoId, status: { in: ['PAID', 'COMPLIMENTARY'] } },
      });
      ticketsBought = ticketSales.reduce((sum, s) => sum + s.quantity, 0);
      ticketsValue = ticketSales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    }

    const feeValue = part.registrationFeeCharged.toNumber();
    const totalSpent = feeValue + costumesValue + ticketsValue;

    // Resolve charges for this participant
    const entry = financialEntries.find((e) => e.id === part.revenueEntryId);
    const asaasPaymentId = entry?.asaasPaymentId;
    let participantCharges: any[] = [];

    if (asaasPaymentId) {
      const direct = directCharges.filter((c) => c.asaasPaymentId === asaasPaymentId);
      const planIdsForDirect = direct
        .map((c) => c.standaloneInstallmentPlanId)
        .filter((id): id is string => Boolean(id));

      const planFromPaymentId = plans.filter((p) => p.asaasInstallmentId === asaasPaymentId);
      const planIdsFromPayment = planFromPaymentId.map((p) => p.id);

      const allReferencedPlanIds = Array.from(new Set([...planIdsForDirect, ...planIdsFromPayment]));

      const planCh = planCharges.filter((c) => c.standaloneInstallmentPlanId && allReferencedPlanIds.includes(c.standaloneInstallmentPlanId));
      const planFromPaymentIdCh = planFromPaymentId.flatMap((p) => p.charges);

      const seen = new Set();
      participantCharges = [
        ...direct,
        ...planCh,
        ...planFromPaymentIdCh,
      ].filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    const paymentDetails = calculateParticipantPayment(
      feeValue,
      part.isFeePaid,
      entry,
      participantCharges
    );
    const removalDecision = part.cancelledAt
      ? await buildEventParticipantRemovalDecision(prisma, ctx, eventId, part)
      : null;

    participantData.push({
      id: part.id,
      contaId: part.contaId,
      eventId: part.eventId,
      type: part.type,
      alunoId: part.alunoId,
      aluno: part.aluno
        ? { id: part.aluno.id, nome: part.aluno.nome, foto: part.aluno.foto }
        : null,
      displayName: part.displayName,
      registrationFeeCharged: feeValue,
      isFeePaid: part.isFeePaid,
      feePaymentMethod: part.feePaymentMethod,
      notes: part.notes,
      createdAt: part.createdAt.toISOString(),
      cancelledAt: toIso(part.cancelledAt),
      percentPaid: paymentDetails.percentPaid,
      totalPaid: paymentDetails.totalPaid,
      totalRefunded: paymentDetails.totalRefunded,
      netPaid: paymentDetails.netPaid,
      financialStatus: part.cancelledAt ? 'CANCELADO' : paymentDetails.status,
      canRemove: removalDecision?.canRemove ?? false,
      canReactivate: part.cancelledAt ? (removalDecision?.canRemove ?? false) : false,
      removalBlockReasons: removalDecision?.canRemove === false ? removalDecision.reasons : [],
      metrics: {
        costumeCount,
        pendingCostumes,
        costumesValue,
        ticketsBought,
        ticketsValue,
        totalSpent,
      },
    });
  }

  return participantData;
}

export async function deleteSchoolEvent(ctx: EventsContext, eventId: string) {
  const event = await prisma.schoolEvent.findFirst({
    where: { id: eventId, contaId: ctx.contaId },
  });

  if (!event) {
    throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  }

  await prisma.$transaction(async (tx) => {
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.delete',
      entityType: 'SchoolEvent',
      entityId: eventId,
      eventId,
      before: event,
      after: null,
    });

    await tx.schoolEvent.delete({
      where: { id: eventId, contaId: ctx.contaId },
    });
  });

  return { success: true };
}

export async function deleteCostumeAssignment(ctx: EventsContext, assignmentId: string) {
  const current = await prisma.eventCostumeAssignment.findFirst({
    where: { id: assignmentId, contaId: ctx.contaId },
    include: { event: true },
  });
  if (!current) {
    throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino não encontrado.', 404);
  }
  assertOperationalEvent(current.event.status);

  if (current.isPaid) {
    throw new EventsError(
      'EXCLUSAO_BLOQUEADA_PAGO',
      'Não é possível excluir um vínculo de figurino que já foi pago. Por favor, marque o pagamento como pendente ou estorne-o antes de excluir.',
      400
    );
  }

  await prisma.$transaction(async (tx) => {
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costumeAssignment.delete',
      entityType: 'EventCostumeAssignment',
      entityId: assignmentId,
      eventId: current.eventId,
      before: current,
      after: null,
    });

    await tx.eventCostumeAssignment.delete({
      where: { id: assignmentId },
    });

    if (current.revenueEntryId) {
      await tx.eventFinancialEntry.deleteMany({
        where: { contaId: ctx.contaId, id: current.revenueEntryId },
      });
    }
  });

  return { success: true };
}

export async function updateTicketSale(ctx: EventsContext, saleId: string, input: UpdateTicketSaleInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({
      where: { id: saleId, contaId: ctx.contaId },
      include: { lot: { include: { event: true } } },
    });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    assertOperationalEvent(current.lot.event.status);

    const lotId = input.lotId ?? current.lotId;
    const lot = lotId === current.lotId ? current.lot : await tx.eventTicketLot.findFirst({
      where: { id: lotId, contaId: ctx.contaId },
    });
    if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);

    const quantity = input.quantity ?? current.quantity;

    // Check stock if quantity or lot changed
    if (lotId !== current.lotId || quantity !== current.quantity) {
      const sold = await tx.eventTicketSale.aggregate({
        where: {
          contaId: ctx.contaId,
          lotId: lot.id,
          id: { not: saleId },
          status: { in: ['PENDING', 'PAID', 'COMPLIMENTARY'] },
        },
        _sum: { quantity: true },
      });
      const quantitySoldOthers = sold._sum.quantity ?? 0;
      if (quantitySoldOthers + quantity > lot.quantityTotal) {
        throw new EventsError('ESTOQUE_INSUFICIENTE', 'Não há ingressos suficientes neste lote.', 409);
      }
    }

    const newStatus = input.status ?? current.status;
    const paymentMethod = input.paymentMethod ?? current.paymentMethod;

    const resolvedStatus = paymentMethod === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : newStatus;

    const unitPrice = toMoney(lot.unitPrice);
    const totalAmount = resolvedStatus === 'COMPLIMENTARY' ? 0 : unitPrice * quantity;

    const now = new Date();
    
    // Status transition validation
    if (resolvedStatus !== current.status) {
      const transition = validateTicketSaleStatusTransition(current.status, resolvedStatus);
      if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);
    }

    const updated = await tx.eventTicketSale.update({
      where: { id: saleId },
      data: {
        buyerName: input.buyerName,
        alunoId: input.alunoId === undefined ? undefined : input.alunoId,
        responsavelId: input.responsavelId === undefined ? undefined : input.responsavelId,
        lotId,
        quantity,
        unitPriceSnapshot: decimal(unitPrice),
        totalAmount: decimal(totalAmount),
        paymentMethod,
        status: resolvedStatus,
        notes: input.notes === undefined ? undefined : input.notes,
        paidAt: resolvedStatus === 'PAID' ? (current.paidAt ?? now) : null,
        cancelledAt: resolvedStatus === 'CANCELLED' ? (current.cancelledAt ?? now) : null,
        refundedAt: resolvedStatus === 'REFUNDED' ? (current.refundedAt ?? now) : null,
      },
    });

    // Sync financial entries
    if (resolvedStatus === 'COMPLIMENTARY' || totalAmount === 0) {
      // If it has financial entry, delete it
      if (current.revenueEntryId) {
        await tx.eventFinancialEntry.delete({
          where: { id: current.revenueEntryId },
        });
        await tx.eventTicketSale.update({
          where: { id: saleId },
          data: { revenueEntryId: null },
        });
      }
    } else {
      if (current.revenueEntryId) {
        // Update existing financial entry
        const entryStatus = resolvedStatus === 'PAID' ? 'RECEIVED' : (resolvedStatus === 'CANCELLED' ? 'CANCELLED' : (resolvedStatus === 'REFUNDED' ? 'REFUNDED' : 'PENDING'));
        await tx.eventFinancialEntry.update({
          where: { id: current.revenueEntryId },
          data: {
            description: `Venda de ingresso - ${lot.name}`,
            expectedAmount: decimal(totalAmount),
            actualAmount: resolvedStatus === 'PAID' ? decimal(totalAmount) : (resolvedStatus === 'REFUNDED' ? decimal(totalAmount) : null),
            status: entryStatus,
            paymentMethod,
            realizedAt: resolvedStatus === 'PAID' ? (current.paidAt ?? now) : null,
            refundedAt: resolvedStatus === 'REFUNDED' ? (current.refundedAt ?? now) : null,
            cancelledAt: resolvedStatus === 'CANCELLED' ? (current.cancelledAt ?? now) : null,
          },
        });
      } else {
        // Create new financial entry
        const entryStatus = resolvedStatus === 'PAID' ? 'RECEIVED' : (resolvedStatus === 'CANCELLED' ? 'CANCELLED' : (resolvedStatus === 'REFUNDED' ? 'REFUNDED' : 'PENDING'));
        const entry = await tx.eventFinancialEntry.create({
          data: {
            contaId: ctx.contaId,
            eventId: lot.eventId,
            type: 'REVENUE',
            category: 'Venda de ingresso',
            description: `Venda de ingresso - ${lot.name}`,
            originType: 'TICKET_SALE',
            originId: saleId,
            expectedAmount: decimal(totalAmount),
            actualAmount: resolvedStatus === 'PAID' ? decimal(totalAmount) : null,
            status: entryStatus,
            paymentMethod,
            realizedAt: resolvedStatus === 'PAID' ? now : null,
            createdByUserId: ctx.userId,
          },
        });
        await tx.eventTicketSale.update({
          where: { id: saleId },
          data: { revenueEntryId: entry.id },
        });
      }
    }

    // Sync quantities
    await syncLotQuantity(tx, ctx.contaId, current.lotId);
    if (lotId !== current.lotId) {
      await syncLotQuantity(tx, ctx.contaId, lotId);
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.update',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: lot.eventId,
      before: current,
      after: updated,
      metadata: { lotId },
    });

    return getTicketSaleDto(tx, ctx.contaId, saleId);
  });
}

export async function deleteTicketSale(ctx: EventsContext, saleId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({
      where: { id: saleId, contaId: ctx.contaId },
    });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    // Business rule: Prevent deletion of PAID sales to preserve financial audit trail
    if (current.status === 'PAID') {
      throw new EventsError(
        'EXCLUSAO_BLOQUEADA_PAGO',
        'Não é possível excluir uma venda de ingresso que já foi paga. Por favor, estorne a venda primeiro.',
        400
      );
    }

    // Delete associated financial entry if exists
    if (current.revenueEntryId) {
      await tx.eventFinancialEntry.delete({
        where: { id: current.revenueEntryId },
      });
    }

    await tx.eventTicketSale.delete({
      where: { id: saleId },
    });

    await syncLotQuantity(tx, ctx.contaId, current.lotId);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.delete',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: current.eventId,
      before: current,
      after: null,
    });

    return { success: true };
  });
}

export async function deleteTicketLot(ctx: EventsContext, lotId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketLot.findFirst({
      where: { id: lotId, contaId: ctx.contaId },
    });
    if (!current) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);

    // Business rule: Prevent deletion if any sales have been made
    const salesCount = await tx.eventTicketSale.count({
      where: { contaId: ctx.contaId, lotId },
    });

    if (salesCount > 0) {
      throw new EventsError(
        'EXCLUSAO_BLOQUEADA_VENDAS',
        'Não é possível excluir um lote que já possui registros de vendas. Se necessário, cancele/exclua as vendas primeiro.',
        400
      );
    }

    // Business rule: Prevent deletion if lot is linked to map sections
    const sectionsCount = await tx.eventMapSection.count({
      where: { contaId: ctx.contaId, lotId },
    });
    if (sectionsCount > 0) {
      throw new EventsError(
        'EXCLUSAO_BLOQUEADA_MAPA',
        'Não é possível excluir um lote que está vinculado a um setor do mapa do evento.',
        400
      );
    }

    await tx.eventTicketLot.delete({
      where: { id: lotId },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketLot.delete',
      entityType: 'EventTicketLot',
      entityId: lotId,
      eventId: current.eventId,
      before: current,
      after: null,
    });

    return { success: true };
  });
}

export async function deleteCostume(ctx: EventsContext, costumeId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventCostume.findFirst({
      where: { id: costumeId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!current) throw new EventsError('FIGURINO_NAO_ENCONTRADO', 'Figurino não encontrado.', 404);
    assertOperationalEvent(current.event.status);

    // Business rule: Prevent deletion if any students/groups are assigned to this costume
    const assignmentsCount = await tx.eventCostumeAssignment.count({
      where: { contaId: ctx.contaId, costumeId },
    });
    if (assignmentsCount > 0) {
      throw new EventsError(
        'EXCLUSAO_BLOQUEADA_VINCULOS',
        'Não é possível excluir um figurino que possui alunos vinculados.',
        400
      );
    }

    // Business rule: Prevent deletion if there are paid financial entries associated with it
    const paidFinancialEntriesCount = await tx.eventFinancialEntry.count({
      where: {
        contaId: ctx.contaId,
        originType: 'COSTUME',
        originId: costumeId,
        status: 'PAID',
      },
    });
    if (paidFinancialEntriesCount > 0) {
      throw new EventsError(
        'EXCLUSAO_BLOQUEADA_PAGO',
        'Não é possível excluir um figurino que possui lançamentos financeiros pagos.',
        400
      );
    }

    // Delete any pending financial entries associated with the costume
    await tx.eventFinancialEntry.deleteMany({
      where: {
        contaId: ctx.contaId,
        originType: 'COSTUME',
        originId: costumeId,
        status: 'PENDING',
      },
    });

    // Delete the costume itself
    await tx.eventCostume.delete({
      where: { id: costumeId },
    });

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.costume.delete',
      entityType: 'EventCostume',
      entityId: costumeId,
      eventId: current.eventId,
      before: current,
      after: null,
    });

    return { success: true };
  });
}
