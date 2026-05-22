import { Prisma, PrismaClient } from '@prisma/client';

import {
  calculateEventMetrics,
  validateCostumeAssignmentStatusTransition,
  validateSchoolEventStatusTransition,
  validateTicketLotStatusTransition,
  validateTicketSaleStatusTransition,
  type EventMetrics,
} from '@alusa/domain/events';

import { prisma } from '../prisma';
import type {
  CreateCostumeAssignmentInput,
  CreateCostumeInput,
  CreateEventFinancialEntryInput,
  CreateSchoolEventInput,
  CreateTicketLotInput,
  CreateTicketSaleInput,
  ListSchoolEventsQuery,
  UpdateCostumeAssignmentInput,
  UpdateCostumeInput,
  UpdateEventFinancialEntryInput,
  UpdateSchoolEventInput,
  UpdateTicketLotInput,
} from './events.schema';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class EventsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
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

function buildMetrics(record: Pick<SchoolEventRecord, 'ticketSales' | 'ticketLots' | 'financialEntries' | 'assignments'>): EventMetrics {
  return calculateEventMetrics({
    ticketSales: record.ticketSales.map((sale) => ({
      status: sale.status,
      quantity: sale.quantity,
      totalAmount: toMoney(sale.totalAmount),
    })),
    ticketLots: record.ticketLots.map((lot) => ({
      quantityTotal: lot.quantityTotal,
      quantitySold: lot.quantitySold,
    })),
    financialEntries: record.financialEntries.map((entry) => ({
      type: entry.type,
      status: entry.status,
      expectedAmount: toMoney(entry.expectedAmount),
      actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
      originType: entry.originType,
    })),
    costumeAssignments: record.assignments.map((assignment) => ({
      status: assignment.status,
      chargedValue: assignment.chargedValue == null ? null : toMoney(assignment.chargedValue),
      isPaid: assignment.isPaid,
    })),
  });
}

export function mapSchoolEvent(record: SchoolEventRecord) {
  const metrics = buildMetrics(record);

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

  const data = records.map(mapSchoolEvent);
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
  return mapSchoolEvent(await getEventRecordOrThrow(ctx.contaId, eventId));
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
  };
}

export async function listTicketSales(ctx: Pick<EventsContext, 'contaId'>, input: { eventId?: string } = {}) {
  const sales = await prisma.eventTicketSale.findMany({
    where: { contaId: ctx.contaId, ...(input.eventId ? { eventId: input.eventId } : {}) },
    include: {
      event: { select: { id: true, name: true, startsAt: true } },
      lot: { select: { id: true, name: true, ticketType: true } },
      aluno: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
      createdBy: { select: { id: true, nome: true } },
    },
    orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
  });
  return sales.map(mapTicketSale);
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
      data: { status: 'REFUNDED', refundedAt: now, notes: reason ?? current.notes },
    });
    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'REFUNDED', refundedAt: now, actualAmount: current.totalAmount },
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
    assertOperationalEvent(event.status);

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
    assertOperationalEvent(current.event.status);

    const updated = await tx.eventCostume.update({
      where: { id: costumeId },
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        size: input.size,
        color: input.color,
        accessories: input.accessories,
        schoolCost: input.schoolCost == null ? undefined : decimal(input.schoolCost),
        chargedValue: input.chargedValue == null ? undefined : decimal(input.chargedValue),
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

    if (input.status === 'DELIVERED' && !input.alunoId) {
      throw new EventsError('ALUNO_OBRIGATORIO', 'Informe o aluno antes de marcar entrega.', 422);
    }
    if (input.returnedAt && !input.deliveredAt) {
      throw new EventsError('DEVOLUCAO_INVALIDA', 'Não é possível devolver antes da entrega.', 422);
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
        chargedValue: input.chargedValue == null ? costume.chargedValue : decimal(input.chargedValue),
        isPaid: input.isPaid,
        deliveredAt: input.deliveredAt,
        returnedAt: input.returnedAt,
        deliveredByUserId: input.status === 'DELIVERED' ? ctx.userId : null,
        notes: input.notes,
      },
    });

    const chargedValue = toMoney(assignment.chargedValue);
    if (chargedValue > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'REVENUE',
          category: 'Figurino',
          description: `Figurino - ${costume.name}`,
          originType: 'COSTUME_ASSIGNMENT',
          originId: assignment.id,
          expectedAmount: decimal(chargedValue),
          actualAmount: assignment.isPaid ? decimal(chargedValue) : null,
          status: assignment.isPaid ? 'RECEIVED' : 'PENDING',
          realizedAt: assignment.isPaid ? new Date() : null,
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
      if (input.status === 'DELIVERED' && !current.alunoId) {
        throw new EventsError('ALUNO_OBRIGATORIO', 'Informe o aluno antes de marcar entrega.', 422);
      }
    }

    if ((input.status === 'RETURNED' || input.returnedAt) && !current.deliveredAt && !input.deliveredAt) {
      throw new EventsError('DEVOLUCAO_INVALIDA', 'Não é possível devolver antes da entrega.', 422);
    }

    const now = new Date();
    const updated = await tx.eventCostumeAssignment.update({
      where: { id: assignmentId },
      data: {
        status: input.status,
        definedSize: input.definedSize,
        chargedValue: input.chargedValue == null ? undefined : decimal(input.chargedValue),
        isPaid: input.isPaid,
        deliveredAt: input.deliveredAt ?? (input.status === 'DELIVERED' ? now : undefined),
        returnedAt: input.returnedAt ?? (input.status === 'RETURNED' ? now : undefined),
        deliveredByUserId: input.status === 'DELIVERED' ? ctx.userId : undefined,
        notes: input.notes,
      },
    });

    const chargedValue = toMoney(updated.chargedValue);
    if (updated.revenueEntryId && chargedValue > 0) {
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: ctx.contaId, id: updated.revenueEntryId, originType: 'COSTUME_ASSIGNMENT' },
        data: {
          expectedAmount: decimal(chargedValue),
          actualAmount: updated.isPaid ? decimal(chargedValue) : null,
          status: updated.isPaid ? 'RECEIVED' : 'PENDING',
          realizedAt: updated.isPaid ? now : null,
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
    assertOperationalEvent(event.status);

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
        actualAmount: input.actualAmount == null ? null : decimal(input.actualAmount),
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
    assertOperationalEvent(current.event.status);

    const updated = await tx.eventFinancialEntry.update({
      where: { id: entryId },
      data: {
        type: input.type,
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        expectedAmount: input.expectedAmount == null ? undefined : decimal(input.expectedAmount),
        actualAmount: input.actualAmount == null ? undefined : decimal(input.actualAmount),
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
  const mapped = events.map(mapSchoolEvent);
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
