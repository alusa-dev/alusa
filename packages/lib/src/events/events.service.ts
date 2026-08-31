import { Prisma, PrismaClient, EventPaymentMethod } from '@prisma/client';

const mapToEventPaymentMethod = (method?: string | null): EventPaymentMethod => {
  if (!method) return 'OTHER';
  const allowed = ['CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER', 'COMPLIMENTARY', 'OTHER'];
  if (allowed.includes(method)) return method as EventPaymentMethod;
  return 'OTHER';
};

import {
  buildStaffSaleTicketsUrl,
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
  convergeStandaloneInstallmentPlanStatus,
  listStandaloneInstallmentPlanIdsForParticipant,
} from '../services/standalone-installment-plan-status.service';
import { getEventAsaasPaymentProvider } from './event-asaas-payment-provider';
import { createEventContractForParticipant } from './event-contracts.service';
import {
  canRemoveEventParticipant,
  type EventParticipantRemovalDecision,
  type EventParticipantRemovalFacts,
} from './event-participant-lifecycle';
import {
  assertEventScopedAssignmentLinks,
  assertEventScopedTicketSaleLinks,
  listEventScopedResources,
  type EventScopedResources,
} from './event-participant-scope';
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
  ManualEventParticipantPaymentInput,
} from './events.schema';
import {
  eventPaymentRulesFromRecord,
  eventPaymentRulesToPersistence,
  normalizeEventPaymentRules,
} from './events-payment-rules';

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

export type PermanentlyDeleteEventParticipantInput = {
  confirmation: string;
  motivo: string;
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

export async function recordEventAudit(
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

const PARTICIPANT_FINANCIAL_STATUS_PRIORITY: Record<string, number> = {
  ATRASADO: 0,
  PARCIAL: 1,
  PENDENTE: 2,
  EM_DIA: 3,
  ESTORNADO: 4,
  QUITADO: 5,
  ISENTO: 6,
  CANCELADO: 7,
};

function participantStatusPriority(status: string | null | undefined) {
  return PARTICIPANT_FINANCIAL_STATUS_PRIORITY[status ?? ''] ?? 2;
}

function participantDueDate(entry: any, charges: any[]) {
  const dates = [entry?.dueDate, ...charges.map((charge) => charge.dueDate)]
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()));
  return dates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
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
    paymentRules: eventPaymentRulesFromRecord(record),
    contratoModeloId: record.contratoModeloId ?? null,
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
    if (input.contratoModeloId) {
      const modelo = await tx.contratoModelo.findFirst({
        where: { id: input.contratoModeloId, contaId: ctx.contaId, status: 'ATIVO' },
        select: { id: true },
      });
      if (!modelo) throw new EventsError('MODELO_CONTRATO_NAO_ENCONTRADO', 'Modelo de contrato não encontrado.', 422);
    }
    const ticketSettings = resolveTicketSettings(input);
    const paymentRules = normalizeEventPaymentRules(input.paymentRules);
    const paymentRulesPersistence = eventPaymentRulesToPersistence(paymentRules);
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
        ...paymentRulesPersistence,
        contratoModeloId: input.contratoModeloId ?? null,
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
    if (input.contratoModeloId) {
      const modelo = await tx.contratoModelo.findFirst({
        where: { id: input.contratoModeloId, contaId: ctx.contaId, status: 'ATIVO' },
        select: { id: true },
      });
      if (!modelo) throw new EventsError('MODELO_CONTRATO_NAO_ENCONTRADO', 'Modelo de contrato não encontrado.', 422);
    }
    const ticketSettings = resolveTicketSettings(input, current);
    const paymentRules = normalizeEventPaymentRules(input.paymentRules);
    const paymentRulesPersistence = input.paymentRules === undefined
      ? {}
      : eventPaymentRulesToPersistence(paymentRules);

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
        ...paymentRulesPersistence,
        contratoModeloId: input.contratoModeloId,
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

export type { EventScopedResources } from './event-participant-scope';

export async function getEventScopedResources(
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
): Promise<EventScopedResources> {
  return listEventScopedResources(prisma, ctx.contaId, eventId);
}

export async function listEventResources(ctx: Pick<EventsContext, 'contaId'>) {
  const [users, alunos, responsaveis, turmas, events, contratoModelos] = await Promise.all([
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
    prisma.contratoModelo.findMany({
      where: { contaId: ctx.contaId, status: 'ATIVO' },
      select: { id: true, nome: true, versao: true },
      orderBy: [{ nome: 'asc' }, { versao: 'desc' }],
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
    contratoModelos,
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

    if (event.ticketMode !== 'NUMBERED_SEATS' && (!input.quantityTotal || input.quantityTotal < 1)) {
      throw new EventsError('QUANTIDADE_INVALIDA', 'Informe a quantidade do lote.', 422);
    }

    const lot = await tx.eventTicketLot.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        name: input.name,
        ticketType: input.ticketType,
        unitPrice: decimal(input.unitPrice),
        quantityTotal: event.ticketMode === 'NUMBERED_SEATS' ? 0 : (input.quantityTotal ?? 0),
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

    if (input.quantityTotal != null && current.event.ticketMode !== 'NUMBERED_SEATS' && input.quantityTotal < current.quantitySold) {
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
        quantityTotal: current.event.ticketMode === 'NUMBERED_SEATS' ? undefined : input.quantityTotal,
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
  const source = sale.eventMapOrderId ? ('PUBLIC_ORDER' as const) : ('MANUAL_SALE' as const);
  const chargeDetailUrl = sale.eventMapOrderId
    ? `/cobrancas/event-map-order:${sale.eventMapOrderId}`
    : `/cobrancas/event-ticket-sale:${sale.id}`;

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
    source,
    eventMapOrderId: sale.eventMapOrderId,
    paymentProvider: sale.paymentProvider,
    asaasPaymentId: sale.asaasPaymentId,
    paymentStatus: sale.paymentStatus,
    chargeDetailUrl,
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
    paymentStatus: order.paymentStatus,
    reservationExpiresAt: toIso(order.expiresAt),
    invoiceUrl: order.invoiceUrl,
    chargeDetailUrl: `/cobrancas/event-map-order:${order.id}`,
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
        saleSeats: {
          select: {
            id: true,
            sectionName: true,
            seatLabel: true,
            unitPriceSnapshot: true,
          },
          orderBy: [{ sectionName: 'asc' }, { seatLabel: 'asc' }],
        },
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
        select: { id: true, status: true, accessToken: true, invoiceUrl: true, asaasPaymentId: true, paymentStatus: true },
      })
    : [];
  const publicOrdersById = new Map(publicOrders.map((order) => [order.id, order]));

  const mappedSales = sales.map((sale) => {
    const dto = mapTicketSale(sale);
    if (sale.eventMapOrderId) {
      const order = publicOrdersById.get(sale.eventMapOrderId);
      return {
        ...dto,
        source: 'PUBLIC_ORDER' as const,
        asaasPaymentId: dto.asaasPaymentId ?? order?.asaasPaymentId ?? null,
        paymentStatus: dto.paymentStatus ?? order?.paymentStatus ?? null,
        invoiceUrl: order?.invoiceUrl ?? null,
        chargeDetailUrl: order ? `/cobrancas/event-map-order:${order.id}` : dto.chargeDetailUrl,
        ticketsUrl:
          order?.status === 'CONFIRMED'
            ? `/api/events/public-orders/${order.id}/tickets`
            : null,
      };
    }

    if (sale.saleSeats.length > 0) {
      return {
        ...dto,
        source: 'MANUAL_SALE' as const,
        hasSeatedTickets: true,
        seats: sale.saleSeats.map((seat) => ({
          id: seat.id,
          sectionName: seat.sectionName,
          seatLabel: seat.seatLabel,
          unitPrice: toMoney(seat.unitPriceSnapshot),
        })),
        ticketsUrl: buildStaffSaleTicketsUrl(sale.id, sale.status, sale.saleSeats.length),
      };
    }

    return dto;
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
  if (input.holdToken) {
    const { createSeatedTicketSale } = await import('./map/staff-map-sales.service');
    const result = await createSeatedTicketSale(ctx, { ...input, holdToken: input.holdToken });
    const primary = await getTicketSaleDto(prisma, ctx.contaId, result.primarySaleId);
    return { ...primary, groupedSaleIds: result.saleIds };
  }

  if (!input.lotId || !input.quantity) {
    throw new EventsError('DADOS_VENDA_INVALIDOS', 'Informe lote e quantidade para venda simples.', 422);
  }

  const event = await prisma.schoolEvent.findFirst({
    where: { id: input.eventId, contaId: ctx.contaId },
    select: { ticketMode: true },
  });
  if (event?.ticketMode === 'NUMBERED_SEATS') {
    throw new EventsError(
      'VENDA_ASSENTO_OBRIGATORIA',
      'Este evento usa assentos numerados. Selecione os assentos no mapa antes de registrar a venda.',
      409,
    );
  }

  const lotId = input.lotId;
  const quantity = input.quantity;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EventTicketLot" WHERE id = ${lotId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;

    const lot = await tx.eventTicketLot.findFirst({
      where: { id: lotId, contaId: ctx.contaId, eventId: input.eventId },
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
    if (quantitySold + quantity > lot.quantityTotal) {
      throw new EventsError('ESTOQUE_INSUFICIENTE', 'Não há ingressos suficientes neste lote.', 409);
    }

    const saleStatus = input.paymentMethod === 'COMPLIMENTARY' ? 'COMPLIMENTARY' : input.status;
    if (!['PENDING', 'PAID', 'COMPLIMENTARY'].includes(saleStatus)) {
      throw new EventsError('STATUS_VENDA_INVALIDO', 'Use pendente, pago ou cortesia ao criar venda.', 422);
    }

    await assertEventScopedTicketSaleLinks(tx, ctx.contaId, input.eventId, {
      alunoId: input.alunoId,
      responsavelId: input.responsavelId,
    });

    const unitPrice = toMoney(lot.unitPrice);
    const totalAmount = saleStatus === 'COMPLIMENTARY' ? 0 : unitPrice * quantity;
    const sale = await tx.eventTicketSale.create({
      data: {
        contaId: ctx.contaId,
        eventId: lot.eventId,
        lotId: lot.id,
        buyerName: input.buyerName,
        alunoId: input.alunoId,
        responsavelId: input.responsavelId,
        quantity,
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
    const { releaseSeatsForTicketSale } = await import('./map/staff-map-sales.service');
    await releaseSeatsForTicketSale(tx, ctx.contaId, saleId);

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

    // A venda vinculada ao Asaas deve passar pelo endpoint financeiro. O
    // webhook é a fonte da verdade para o estado final e também atualiza os
    // ingressos/lançamentos relacionados. Nunca confirme o estorno localmente
    // antes da confirmação do provedor.
    if (current.asaasPaymentId || current.paymentProvider === 'ASAAS') {
      throw new EventsError(
        'ESTORNO_ASAAS_PENDENTE',
        'Esta venda possui pagamento Asaas. Solicite o estorno pela cobrança para aguardar a confirmação do webhook.',
        409,
      );
    }

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
    const { releaseSeatsForTicketSale } = await import('./map/staff-map-sales.service');
    await releaseSeatsForTicketSale(tx, ctx.contaId, saleId);

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

/**
 * Applies the final Asaas refund state to legacy/direct ticket-sale payments.
 * Public map orders are synchronized by the map-order webhook flow; this
 * fallback covers EventTicketSale records that have an Asaas payment but no
 * EventMapOrder relation.
 */
export async function refundTicketSalesByAsaasPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  paymentStatus: string;
  isFinalRefund: boolean;
  refundedAmount?: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const sales = await tx.eventTicketSale.findMany({
      where: {
        contaId: params.contaId,
        asaasPaymentId: params.asaasPaymentId,
        eventMapOrderId: null,
      },
    });
    if (sales.length === 0) return null;

    const now = new Date();
    const { releaseSeatsForTicketSale } = await import('./map/staff-map-sales.service');
    for (const sale of sales) {
      if (!params.isFinalRefund) {
        await tx.eventTicketSale.update({
          where: { id: sale.id },
          data: { paymentStatus: params.paymentStatus },
        });
        continue;
      }

      const refundedAmount = params.refundedAmount == null
        ? toMoney(sale.totalAmount)
        : Math.min(toMoney(sale.totalAmount), Math.max(params.refundedAmount, 0));
      await tx.eventTicketSale.update({
        where: { id: sale.id },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundedAmount: decimal(refundedAmount),
          paymentStatus: params.paymentStatus,
        },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: params.contaId, originType: 'TICKET_SALE', originId: sale.id },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundedAmount: decimal(refundedAmount),
          netAmount: decimal(Math.max(toMoney(sale.totalAmount) - refundedAmount, 0)),
          paymentStatus: params.paymentStatus,
        },
      });
      await syncLotQuantity(tx, params.contaId, sale.lotId);
      await releaseSeatsForTicketSale(tx, params.contaId, sale.id);
    }

    return { count: sales.length, status: params.isFinalRefund ? 'REFUNDED' : params.paymentStatus };
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

    await assertEventScopedAssignmentLinks(tx, ctx.contaId, input.eventId, {
      alunoId: input.alunoId,
      turmaId: input.turmaId,
      requireAluno: input.status === 'DELIVERED',
    });

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

    const targetAlunoId = input.alunoId === undefined ? current.alunoId : input.alunoId;
    const targetTurmaId = input.turmaId === undefined ? current.turmaId : input.turmaId;
    const targetStatus = input.status ?? current.status;

    await assertEventScopedAssignmentLinks(tx, ctx.contaId, current.eventId, {
      alunoId: targetAlunoId,
      turmaId: targetTurmaId,
      requireAluno: targetStatus === 'DELIVERED',
    });

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
      if (input.status === 'DELIVERED' && !targetAlunoId) {
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

    if (updated.status === 'CANCELLED' && updated.revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: {
          contaId: ctx.contaId,
          id: updated.revenueEntryId,
          originType: 'COSTUME_ASSIGNMENT',
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          actualAmount: null,
          realizedAt: null,
        },
      });
    } else if (updated.billingMode !== 'SEPARATE_CHARGE') {
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
      const chargedValue = toMoney(updated.chargedValue);
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
    } else {
      const chargedValue = toMoney(updated.chargedValue);
      if (chargedValue > 0) {
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
    grossAmount: entry.grossAmount == null ? null : toMoney(entry.grossAmount),
    discountAmount: toMoney(entry.discountAmount),
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
  entries: Prisma.EventFinancialEntryGetPayload<Prisma.EventFinancialEntryDefaultArgs>[],
  participantPaymentIds: string[] = [],
) {
  const asaasPaymentIds = [
    ...entries.map((entry) => entry.asaasPaymentId),
    ...participantPaymentIds,
  ]
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
  const charges = await collectChargesForEntries(db, ctx, financialEntries, [
    participant.asaasPaymentId,
    participant.asaasInstallmentId,
  ].filter((id): id is string => Boolean(id)));

  const ticketOwnerFilters = [
    participant.alunoId ? { alunoId: participant.alunoId } : null,
    participant.responsavelId ? { responsavelId: participant.responsavelId } : null,
  ].filter((filter): filter is { alunoId: string } | { responsavelId: string } => Boolean(filter));

  const costumeOwnerFilters = [
    participant.alunoId ? { alunoId: participant.alunoId } : null,
    participant.turmaId ? { turmaId: participant.turmaId } : null,
  ].filter((filter): filter is { alunoId: string } | { turmaId: string } => Boolean(filter));

  const buyerEmails = normalizeParticipantEmails(participant);

  const [ticketSales, costumeAssignments, publicOrders, eventContractCount] = await Promise.all([
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
    db.eventoContrato.count({
      where: { contaId: ctx.contaId, eventId, participantId: participant.id },
    }),
  ]);

  const facts: EventParticipantRemovalFacts = {
    cancelledAt: participant.cancelledAt,
    eventContractCount,
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

    const financialResponsible = await tx.alunoResponsavel.findFirst({
      where: {
        contaId: ctx.contaId,
        alunoId: input.alunoId,
        ...(input.responsavelId ? { responsavelId: input.responsavelId } : {}),
        responsavel: { financeiro: true },
      },
      orderBy: { id: 'asc' },
      select: { responsavelId: true },
    });
    if (input.responsavelId && !financialResponsible) {
      throw new EventsError('RESPONSAVEL_FINANCEIRO_INVALIDO', 'O responsável financeiro não está vinculado ao aluno.', 422);
    }

    let revenueEntryId: string | null = null;
    const feeOriginal = toMoney(input.registrationFeeOriginal ?? input.registrationFeeCharged ?? 0);
    const feeDiscount = toMoney(input.registrationFeeDiscount ?? Math.max(feeOriginal - (input.registrationFeeCharged ?? 0), 0));
    const feeCharged = toMoney(input.registrationFeeCharged ?? feeOriginal);
    const billingMode = input.billingMode ?? (input.isFeePaid ? 'FULL' : 'INSTALLMENT');
    const entryAmount = input.billingMethod === 'MANUAL_RECEIVED'
      ? toMoney(input.initialPaymentAmount ?? 0)
      : input.entryAmount && input.entryAmount > 0
        ? toMoney(input.entryAmount)
        : input.isFeePaid
          ? toMoney(feeCharged)
          : 0;
    const balanceAmount = toMoney(Math.max(feeCharged - entryAmount, 0));
    const registrationPaymentRules = eventPaymentRulesFromRecord(event);

    // A digital charge is persisted by the financial/Asaas flow. Creating a
    // local entry for the digital component would duplicate the billing list.
    // A manual entry is kept as a separate local receipt.
    if (entryAmount > 0 || input.billingMethod === 'MANUAL_RECEIVED') {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: billingMode === 'ENTRY_INSTALLMENT' ? 'Entrada da taxa de inscrição' : 'Taxa de inscrição',
          expectedAmount: decimal(feeCharged),
          grossAmount: decimal(feeOriginal),
          discountAmount: decimal(feeDiscount),
          actualAmount: entryAmount > 0 ? decimal(entryAmount) : null,
          dueDate: new Date(),
          realizedAt: entryAmount > 0 ? new Date() : null,
          status: entryAmount > 0 && entryAmount >= feeCharged ? 'RECEIVED' : 'PENDING',
          paymentMethod: entryAmount > 0 ? mapToEventPaymentMethod(input.initialPaymentMethod ?? input.entryPaymentMethod ?? input.feePaymentMethod) : null,
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
        responsavelId: financialResponsible?.responsavelId ?? input.responsavelId ?? null,
        displayName: aluno.nome,
        registrationFeeCharged: decimal(feeCharged),
        registrationFeeOriginal: decimal(feeOriginal),
        registrationFeeDiscount: decimal(feeDiscount),
        registrationFeeDiscountType: input.registrationFeeDiscountType ?? null,
        billingMode,
        entryAmount: decimal(entryAmount),
        balanceAmount: decimal(balanceAmount),
        entryPaymentMethod: entryAmount > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
        registrationPaymentRules: registrationPaymentRules ?? Prisma.JsonNull,
        isFeePaid: input.isFeePaid ?? false,
        isFeeExempt: input.isFeeExempt ?? false,
        feePaymentMethod: input.entryPaymentMethod ?? input.feePaymentMethod ?? null,
        revenueEntryId,
        feePaidAmount: decimal(entryAmount),
        notes: input.notes,
      },
    });

    if (revenueEntryId && entryAmount > 0) {
      await tx.eventFinancialPayment.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          financialEntryId: revenueEntryId,
          participantId: participant.id,
          amount: decimal(entryAmount),
          paymentMethod: mapToEventPaymentMethod(input.initialPaymentMethod ?? input.entryPaymentMethod ?? input.feePaymentMethod),
          paidAt: new Date(),
          netAmount: decimal(entryAmount),
          createdByUserId: ctx.userId,
        },
      });
    }

    await createEventContractForParticipant(tx, {
      contaId: ctx.contaId,
      userId: ctx.userId,
      eventId: input.eventId,
      participantId: participant.id,
      alunoId: input.alunoId,
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

type RegisterEventParticipantGroupInput = CreateEventParticipantInput & {
  alunoIds: string[];
  responsavelId: string;
  billingMethod?: string | null;
  chargeType?: string | null;
  installmentCount?: number | null;
  dueDate?: Date | null;
  uiRequestId?: string | null;
};

function allocateGroupAmount(total: number, values: number[]): number[] {
  const normalizedTotal = toMoney(total);
  const totalBase = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (values.length === 0) return [];
  if (totalBase <= 0) return values.map(() => 0);

  const allocations: number[] = [];
  let allocated = 0;
  values.forEach((value, index) => {
    if (index === values.length - 1) {
      allocations.push(toMoney(normalizedTotal - allocated));
      return;
    }
    const amount = toMoney(normalizedTotal * (Math.max(value, 0) / totalBase));
    allocations.push(amount);
    allocated = toMoney(allocated + amount);
  });
  return allocations;
}

export async function registerEventParticipantGroup(
  ctx: EventsContext,
  input: RegisterEventParticipantGroupInput,
) {
  return prisma.$transaction(async (tx) => {
    const alunoIds = [...new Set(input.alunoIds.filter(Boolean))];
    if (alunoIds.length < 2) {
      throw new EventsError('GRUPO_COBRANCA_INCOMPLETO', 'Selecione pelo menos dois alunos para uma cobrança conjunta.', 422);
    }

    if (input.uiRequestId) {
      const existingGroup = await tx.eventBillingGroup.findFirst({
        where: { contaId: ctx.contaId, uiRequestId: input.uiRequestId },
        include: { participants: true },
      });
      if (existingGroup) {
        if (existingGroup.status === 'PENDING') {
          throw new EventsError('COBRANCA_AGRUPADA_EM_PROCESSAMENTO', 'Esta cobrança agrupada já está sendo processada.', 409);
        }
        if (existingGroup.status === 'REQUIRES_RECONCILIATION') {
          throw new EventsError('COBRANCA_AGRUPADA_REQUER_RECONCILIACAO', 'Esta cobrança agrupada precisa ser reconciliada antes de uma nova tentativa.', 409);
        }
        return { group: existingGroup, participants: existingGroup.participants, reused: true };
      }
    }

    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertOperationalEvent(event.status);

    const alunos = await tx.aluno.findMany({
      where: { contaId: ctx.contaId, id: { in: alunoIds } },
      select: {
        id: true,
        nome: true,
        responsaveis: {
          where: { contaId: ctx.contaId, responsavel: { financeiro: true } },
          select: { responsavelId: true },
        },
      },
    });
    if (alunos.length !== alunoIds.length) {
      throw new EventsError('ALUNO_NAO_ENCONTRADO', 'Um ou mais alunos selecionados não foram encontrados.', 404);
    }

    const selectedResponsible = await tx.responsavel.findFirst({
      where: {
        id: input.responsavelId,
        contaId: ctx.contaId,
        financeiro: true,
      },
      select: { id: true, nome: true },
    });
    if (!selectedResponsible) {
      throw new EventsError('RESPONSAVEL_FINANCEIRO_INVALIDO', 'Responsável financeiro inválido para esta conta.', 422);
    }

    const notLinked = alunos.find((aluno) => !aluno.responsaveis.some((link) => link.responsavelId === input.responsavelId));
    if (notLinked) {
      throw new EventsError('RESPONSAVEL_DIVERGENTE', `O responsável financeiro não está vinculado ao aluno ${notLinked.nome}.`, 422);
    }

    const existingParticipants = await tx.eventParticipant.findMany({
      where: { contaId: ctx.contaId, eventId: input.eventId, alunoId: { in: alunoIds } },
      select: { id: true, alunoId: true, cancelledAt: true },
    });
    if (existingParticipants.length > 0) {
      const active = existingParticipants.find((participant) => !participant.cancelledAt);
      if (active) throw new EventsError('PARTICIPANTE_JA_INSCRITO', 'Um dos alunos selecionados já está inscrito neste evento.', 409);
      throw new EventsError('PARTICIPANTE_CANCELADO_EXISTENTE', 'Um dos alunos possui uma inscrição cancelada neste evento. Reative-a separadamente.', 409);
    }

    const feeOriginalPerParticipant = toMoney(input.registrationFeeOriginal ?? input.registrationFeeCharged ?? 0);
    const feeDiscountPerParticipant = toMoney(input.registrationFeeDiscount ?? Math.max(feeOriginalPerParticipant - (input.registrationFeeCharged ?? 0), 0));
    const feePerParticipant = toMoney(input.registrationFeeCharged ?? feeOriginalPerParticipant);
    const totalAmount = toMoney(feePerParticipant * alunoIds.length);
    const isFeePaid = input.isFeePaid ?? false;
    const billingMode = input.billingMode ?? (isFeePaid ? 'FULL' : 'INSTALLMENT');
    const requestedEntryAmount = input.billingMethod === 'MANUAL_RECEIVED'
      ? toMoney(input.initialPaymentAmount ?? 0)
      : input.entryAmount && input.entryAmount > 0
        ? toMoney(input.entryAmount)
        : isFeePaid
          ? totalAmount
          : 0;
    const entryAmount = Math.min(requestedEntryAmount, totalAmount);
    const balanceAmount = toMoney(Math.max(totalAmount - entryAmount, 0));
    const entryAllocations = allocateGroupAmount(entryAmount, alunoIds.map(() => feePerParticipant));
    const group = await tx.eventBillingGroup.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        responsavelId: input.responsavelId,
        status: entryAmount >= totalAmount && totalAmount > 0 ? 'PAID' : entryAmount > 0 ? 'PARTIALLY_PAID' : 'PENDING',
        billingMode,
        totalAmount: decimal(totalAmount),
        originalAmount: decimal(toMoney(feeOriginalPerParticipant * alunoIds.length)),
        discountAmount: decimal(toMoney(feeDiscountPerParticipant * alunoIds.length)),
        entryAmount: decimal(entryAmount),
        balanceAmount: decimal(balanceAmount),
        entryPaymentMethod: entryAmount > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
        billingMethod: input.billingMethod ?? null,
        chargeType: input.chargeType ?? (billingMode === 'ENTRY_INSTALLMENT' || billingMode === 'INSTALLMENT' ? 'INSTALLMENT' : 'ONE_TIME'),
        installmentCount: input.installmentCount ?? null,
        dueDate: input.dueDate ?? null,
        uiRequestId: input.uiRequestId ?? null,
        createdByUserId: ctx.userId,
      },
    });

    const registrationPaymentRules = eventPaymentRulesFromRecord(event);
    const participants: Prisma.EventParticipantGetPayload<Prisma.EventParticipantDefaultArgs>[] = [];
    for (const [index, aluno] of alunos.entries()) {
      const allocatedEntry = entryAllocations[index] ?? 0;
      // Digital grouped charges are represented by the Asaas plan below.
      // Persist an internal entry only for money actually received manually;
      // otherwise this allocation would appear as a second operational charge.
      const participantEntry = input.billingMethod === 'MANUAL_RECEIVED' && allocatedEntry > 0
        ? await tx.eventFinancialEntry.create({
            data: {
              contaId: ctx.contaId,
              eventId: input.eventId,
              type: 'REVENUE',
              category: 'Taxa de inscrição',
              description: 'Entrada manual da cobrança agrupada do evento',
              expectedAmount: decimal(allocatedEntry),
              grossAmount: decimal(feeOriginalPerParticipant),
              discountAmount: decimal(feeDiscountPerParticipant),
              actualAmount: decimal(allocatedEntry),
              dueDate: input.dueDate ?? new Date(),
              realizedAt: new Date(),
              status: 'RECEIVED',
              paymentMethod: mapToEventPaymentMethod(input.entryPaymentMethod ?? input.feePaymentMethod),
              notes: input.notes,
            },
          })
        : null;

      const participant = await tx.eventParticipant.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'STUDENT',
          alunoId: aluno.id,
          responsavelId: input.responsavelId,
          billingGroupId: group.id,
          displayName: aluno.nome,
          registrationFeeCharged: decimal(feePerParticipant),
          registrationFeeOriginal: decimal(feeOriginalPerParticipant),
          registrationFeeDiscount: decimal(feeDiscountPerParticipant),
          registrationFeeDiscountType: input.registrationFeeDiscountType ?? null,
          billingMode,
          entryAmount: decimal(allocatedEntry),
          balanceAmount: decimal(Math.max(feePerParticipant - allocatedEntry, 0)),
          entryPaymentMethod: allocatedEntry > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
          registrationPaymentRules: registrationPaymentRules ?? Prisma.JsonNull,
          isFeePaid,
          isFeeExempt: input.isFeeExempt ?? false,
          feePaymentMethod: input.entryPaymentMethod ?? input.feePaymentMethod ?? null,
          revenueEntryId: participantEntry?.id ?? null,
          feePaidAmount: decimal(allocatedEntry),
          notes: input.notes,
        },
      });

      if (participantEntry) {
        await tx.eventFinancialPayment.create({
          data: {
            contaId: ctx.contaId,
            eventId: input.eventId,
            financialEntryId: participantEntry.id,
            participantId: participant.id,
            amount: decimal(allocatedEntry),
            paymentMethod: mapToEventPaymentMethod(input.initialPaymentMethod ?? input.entryPaymentMethod ?? input.feePaymentMethod),
            paidAt: new Date(),
            netAmount: decimal(allocatedEntry),
            createdByUserId: ctx.userId,
          },
        });
      }

      await createEventContractForParticipant(tx, {
        contaId: ctx.contaId,
        userId: ctx.userId,
        eventId: input.eventId,
        participantId: participant.id,
        alunoId: aluno.id,
      });
      participants.push(participant);
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.group_register',
      entityType: 'EventBillingGroup',
      entityId: group.id,
      eventId: input.eventId,
      after: { group, participantIds: participants.map((participant) => participant.id) },
      metadata: { responsavelId: selectedResponsible.id, alunoIds },
    });

    return { group, participants, reused: false };
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
    return { ok: true, canceledChargeIds: [] as string[], grouped: false };
  }

  if (participant.billingGroupId) {
    const activeGroupParticipants = await prisma.eventParticipant.count({
      where: { contaId: ctx.contaId, billingGroupId: participant.billingGroupId, cancelledAt: null },
    });
    if (activeGroupParticipants > 1) {
      return unregisterEventParticipantGroup(ctx, eventId, participant.billingGroupId);
    }
  }

  const entry = participant.revenueEntryId
    ? await prisma.eventFinancialEntry.findFirst({
        where: { id: participant.revenueEntryId, contaId: ctx.contaId },
      })
    : null;

  const linkedChargeFilters: Prisma.ChargeWhereInput[] = [];
  if (entry?.asaasPaymentId) linkedChargeFilters.push({ asaasPaymentId: entry.asaasPaymentId });
  if (participant.asaasPaymentId) linkedChargeFilters.push({ asaasPaymentId: participant.asaasPaymentId });
  if (participant.asaasInstallmentId) {
    linkedChargeFilters.push({
      standaloneInstallmentPlan: { asaasInstallmentId: participant.asaasInstallmentId },
    });
  }
  if (participant.standaloneChargeId) {
    linkedChargeFilters.push({ standaloneInstallmentPlanId: participant.standaloneChargeId });
    linkedChargeFilters.push({ id: participant.standaloneChargeId });
  }

  const linkedCharges = linkedChargeFilters.length > 0
    ? await prisma.charge.findMany({
        where: { contaId: ctx.contaId, OR: linkedChargeFilters },
      })
    : [];

  const standaloneInstallmentPlanIds = new Set(
    linkedCharges
      .map((charge) => charge.standaloneInstallmentPlanId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const planId of await listStandaloneInstallmentPlanIdsForParticipant({
    contaId: ctx.contaId,
    standaloneChargeId: participant.standaloneChargeId,
    asaasInstallmentId: participant.asaasInstallmentId,
  })) {
    standaloneInstallmentPlanIds.add(planId);
  }

  const openCharges = linkedCharges.filter((charge) =>
    ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'].includes(charge.status),
  );
  if (openCharges.length > 0) {
    const credentials = await loadDecryptedAsaasCredentials(ctx.contaId);
    if (credentials?.apiKey) {
      for (const charge of openCharges) {
        if (!charge.asaasPaymentId) continue;
        await getEventAsaasPaymentProvider().deletePayment({
          apiKey: credentials.apiKey,
          paymentId: charge.asaasPaymentId,
        });
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const payment = calculateParticipantPayment(
      participant.registrationFeeCharged.toNumber(),
      participant.isFeePaid,
      entry,
      linkedCharges,
      participant.isFeeExempt,
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

    if (participant.alunoId) {
      await createEventContractForParticipant(tx, {
        contaId: ctx.contaId,
        userId: ctx.userId,
        eventId,
        participantId,
        alunoId: participant.alunoId,
      });
    }

    if (openCharges.length > 0) {
      await tx.charge.updateMany({
        where: { contaId: ctx.contaId, id: { in: openCharges.map((charge) => charge.id) } },
        data: { status: 'CANCELED', statusUpdatedAt: new Date() },
      });
    }

    for (const planId of standaloneInstallmentPlanIds) {
      await convergeStandaloneInstallmentPlanStatus({
        contaId: ctx.contaId,
        planId,
        db: tx,
      });
    }

    if (entry) {
      const actualAmount = payment.totalPaid > 0 ? decimal(payment.totalPaid) : null;
      await tx.eventFinancialEntry.update({
        where: { id: entry.id },
        data: {
          // A inscrição pode ser cancelada, mas um pagamento manual já
          // realizado continua sendo uma receita histórica. Reabri-lo como
          // PENDING faria a taxa voltar indevidamente à fila de cobranças.
          status: payment.totalPaid > 0 ? 'RECEIVED' : 'CANCELLED',
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

    return { ok: true, canceledChargeIds: openCharges.map((charge) => charge.id), grouped: false };
  });
}

export async function unregisterEventParticipantGroup(ctx: EventsContext, eventId: string, billingGroupId: string) {
  const group = await prisma.eventBillingGroup.findFirst({
    where: { id: billingGroupId, contaId: ctx.contaId, eventId },
    include: { event: true, participants: true },
  });
  if (!group) throw new EventsError('COBRANCA_AGRUPADA_NAO_ENCONTRADA', 'Cobrança agrupada não encontrada.', 404);
  assertOperationalEvent(group.event.status);

  const activeParticipants = group.participants.filter((participant) => !participant.cancelledAt);
  if (activeParticipants.length === 0) {
    return { ok: true, canceledChargeIds: [] as string[], grouped: true };
  }

  const groupCharges = await loadEventBillingGroupCharges(prisma, ctx.contaId, [group]);
  const charges = groupCharges.get(group.id) ?? [];
  const standaloneInstallmentPlanIds = new Set(
    charges
      .map((charge) => charge.standaloneInstallmentPlanId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const planId of await listStandaloneInstallmentPlanIdsForParticipant({
    contaId: ctx.contaId,
    standaloneChargeId: group.standaloneChargeId,
    asaasInstallmentId: group.asaasInstallmentId,
  })) {
    standaloneInstallmentPlanIds.add(planId);
  }
  const openCharges = charges.filter((charge) => ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'].includes(charge.status));
  if (openCharges.length > 0) {
    const credentials = await loadDecryptedAsaasCredentials(ctx.contaId);
    if (credentials?.apiKey) {
      for (const charge of openCharges) {
        if (!charge.asaasPaymentId) continue;
        await getEventAsaasPaymentProvider().deletePayment({
          apiKey: credentials.apiKey,
          paymentId: charge.asaasPaymentId,
        });
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const entryById = new Map(
      (
        await tx.eventFinancialEntry.findMany({
          where: {
            contaId: ctx.contaId,
            id: { in: activeParticipants.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id)) },
          },
        })
      ).map((entry) => [entry.id, entry]),
    );

    const cancelledParticipantIds: string[] = [];
    for (const participant of activeParticipants) {
      const entry = participant.revenueEntryId ? entryById.get(participant.revenueEntryId) : null;
      const participantCharges = allocateChargesToParticipant(
        charges,
        participant.balanceAmount.toNumber(),
        group.balanceAmount.toNumber(),
      );
      const payment = calculateParticipantPayment(
        participant.registrationFeeCharged.toNumber(),
        participant.isFeePaid,
        entry,
        participantCharges,
        participant.isFeeExempt,
      );

      const updated = await tx.eventParticipant.update({
        where: { id: participant.id },
        data: {
          isFeePaid: false,
          financialStatusSnapshot: 'CANCELADO',
          feePaidAmount: decimal(payment.totalPaid),
          feeRefundedAmount: decimal(payment.totalRefunded),
          cancelledAt: new Date(),
        },
      });

      if (participant.alunoId) {
        await createEventContractForParticipant(tx, {
          contaId: ctx.contaId,
          userId: ctx.userId,
          eventId,
          participantId: participant.id,
          alunoId: participant.alunoId,
        });
      }

      if (entry) {
        await tx.eventFinancialEntry.update({
          where: { id: entry.id },
          data: {
            status: payment.totalPaid > 0 ? 'RECEIVED' : 'CANCELLED',
            actualAmount: payment.totalPaid > 0 ? decimal(payment.totalPaid) : null,
            refundedAmount: decimal(payment.totalRefunded),
            netAmount: payment.netPaid > 0 ? decimal(payment.netPaid) : null,
            cancelledAt: payment.totalPaid > 0 ? null : new Date(),
            notes: [entry.notes, 'Cobrança agrupada cancelada; histórico financeiro preservado.'].filter(Boolean).join('\n'),
          },
        });
      }

      await recordEventAudit(tx, {
        contaId: ctx.contaId,
        actorUserId: ctx.userId,
        action: 'events.participant.unregister',
        entityType: 'EventParticipant',
        entityId: participant.id,
        eventId,
        before: participant,
        after: updated,
        metadata: {
          grouped: true,
          billingGroupId: group.id,
          cancelledOpenCharges: openCharges.map((charge) => charge.id),
          paidAmount: payment.totalPaid,
          refundedAmount: payment.totalRefunded,
        },
      });
      cancelledParticipantIds.push(participant.id);
    }

    if (openCharges.length > 0) {
      await tx.charge.updateMany({
        where: { contaId: ctx.contaId, id: { in: openCharges.map((charge) => charge.id) } },
        data: { status: 'CANCELED', statusUpdatedAt: new Date() },
      });
    }

    for (const planId of standaloneInstallmentPlanIds) {
      await convergeStandaloneInstallmentPlanStatus({
        contaId: ctx.contaId,
        planId,
        db: tx,
      });
    }

    const updatedGroup = await tx.eventBillingGroup.update({
      where: { id: group.id, contaId: ctx.contaId },
      data: { status: 'CANCELLED' },
    });
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.group_unregister',
      entityType: 'EventBillingGroup',
      entityId: group.id,
      eventId,
      before: group,
      after: updatedGroup,
      metadata: { cancelledParticipantIds, cancelledOpenCharges: openCharges.map((charge) => charge.id) },
    });

    return {
      ok: true,
      grouped: true,
      canceledChargeIds: openCharges.map((charge) => charge.id),
      cancelledParticipantIds,
    };
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

  const standaloneInstallmentPlanIds = await listStandaloneInstallmentPlanIdsForParticipant({
    contaId: ctx.contaId,
    standaloneChargeId: participant.standaloneChargeId,
    asaasInstallmentId: participant.asaasInstallmentId,
  });

  return prisma.$transaction(async (tx) => {
    for (const planId of standaloneInstallmentPlanIds) {
      await convergeStandaloneInstallmentPlanStatus({
        contaId: ctx.contaId,
        planId,
        db: tx,
      });
    }

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

export async function permanentlyDeleteEventParticipant(
  ctx: EventsContext,
  eventId: string,
  participantId: string,
  input: PermanentlyDeleteEventParticipantInput,
) {
  const confirmation = input.confirmation.trim();
  const motivo = input.motivo.trim();

  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: {
        event: { select: { id: true, name: true, status: true } },
        aluno: { select: { id: true, nome: true, cpf: true } },
        responsavel: { select: { id: true, nome: true, cpf: true } },
      },
    });

    if (!participant) {
      throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    }

    if (!participant.cancelledAt) {
      throw new EventsError(
        'PARTICIPANTE_NAO_CANCELADO',
        'Cancele a inscrição antes de excluí-la definitivamente.',
        409,
      );
    }

    if (!motivo) {
      throw new EventsError('MOTIVO_OBRIGATORIO', 'Informe o motivo da exclusão definitiva.', 422);
    }

    const expectedConfirmation = 'EXCLUIR';
    if (confirmation !== expectedConfirmation) {
      throw new EventsError(
        'CONFIRMACAO_INVALIDA',
        `Digite exatamente "${expectedConfirmation}" para confirmar a exclusão.`,
        422,
      );
    }

    const standaloneInstallmentPlanIds = await listStandaloneInstallmentPlanIdsForParticipant({
      contaId: ctx.contaId,
      standaloneChargeId: participant.standaloneChargeId,
      asaasInstallmentId: participant.asaasInstallmentId,
      db: tx,
    });
    for (const planId of standaloneInstallmentPlanIds) {
      await convergeStandaloneInstallmentPlanStatus({
        contaId: ctx.contaId,
        planId,
        db: tx,
      });
    }

    const contracts = await tx.eventoContrato.findMany({
      where: { contaId: ctx.contaId, eventId, participantId },
      select: { id: true },
    });
    const contractIds = contracts.map((contract) => contract.id);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.permanent_delete',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId,
      before: participant,
      after: null,
      metadata: {
        motivo,
        destructive: true,
        deletedContractIds: contractIds,
        preservedOperationalRecords: true,
        eventStatus: participant.event.status,
      },
    });

    if (contractIds.length > 0) {
      await tx.consentRecord.deleteMany({
        where: {
          contaId: ctx.contaId,
          OR: contractIds.map((contractId) => ({ source: { startsWith: `EVENT_CONTRACT:${contractId}:` } })),
        },
      });
      await tx.eventoContratoDocumento.deleteMany({
        where: { contaId: ctx.contaId, eventoContratoId: { in: contractIds } },
      });
      await tx.eventoContratoEvidence.deleteMany({
        where: { contaId: ctx.contaId, eventoContratoId: { in: contractIds } },
      });
      await tx.eventoContrato.deleteMany({
        where: { contaId: ctx.contaId, eventId, participantId },
      });
    }

    const deleted = await tx.eventParticipant.deleteMany({
      where: { id: participantId, contaId: ctx.contaId, eventId },
    });
    if (deleted.count !== 1) {
      throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'A inscrição não está mais disponível para exclusão.', 404);
    }

    return { ok: true as const };
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
    const billingMode = input.billingMode ?? (isFeePaid ? 'FULL' : 'INSTALLMENT');
    const entryAmount = input.entryAmount && input.entryAmount > 0
      ? toMoney(input.entryAmount)
      : isFeePaid
        ? toMoney(feeCharged)
        : 0;
    const balanceAmount = toMoney(Math.max(feeCharged - entryAmount, 0));
    let revenueEntryId: string | null = null;
    const registrationPaymentRules = eventPaymentRulesFromRecord(participant.event);

    if (entryAmount > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: billingMode === 'ENTRY_INSTALLMENT' ? 'Entrada da taxa de inscrição' : 'Taxa de inscrição',
          expectedAmount: decimal(entryAmount),
          actualAmount: decimal(entryAmount),
          dueDate,
          realizedAt: new Date(),
          status: 'RECEIVED',
          paymentMethod: mapToEventPaymentMethod(input.entryPaymentMethod ?? input.feePaymentMethod),
          notes: input.notes,
          paymentProvider: billingMode === 'ENTRY_INSTALLMENT' ? null : input.paymentProvider ?? null,
          asaasPaymentId: billingMode === 'ENTRY_INSTALLMENT' ? null : input.asaasPaymentId ?? null,
          paymentStatus: billingMode === 'ENTRY_INSTALLMENT' ? null : input.paymentStatus ?? null,
        },
      });
      revenueEntryId = entry.id;
    }

    const updated = await tx.eventParticipant.update({
      where: { id: participantId },
      data: {
        registrationFeeCharged: decimal(feeCharged),
        billingMode,
        entryAmount: decimal(entryAmount),
        balanceAmount: decimal(balanceAmount),
        entryPaymentMethod: entryAmount > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
        registrationPaymentRules: registrationPaymentRules ?? Prisma.JsonNull,
        isFeePaid,
        feePaymentMethod: feeCharged > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
        revenueEntryId,
        standaloneChargeId: input.standaloneChargeId ?? null,
        asaasPaymentId: input.asaasPaymentId ?? null,
        asaasInstallmentId: input.asaasInstallmentId ?? null,
        financialStatusSnapshot: feeCharged <= 0 ? 'ISENTO' : isFeePaid ? 'QUITADO' : entryAmount > 0 ? 'EM_DIA' : 'PENDENTE',
        feePaidAmount: decimal(entryAmount),
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

type ManualPaymentTotals = {
  received: number;
  refunded: number;
  net: number;
};

async function loadManualPaymentTotals(tx: Prisma.TransactionClient, contaId: string, entryId: string): Promise<ManualPaymentTotals> {
  const payments = await tx.eventFinancialPayment.findMany({
    where: { contaId, financialEntryId: entryId },
    select: { amount: true, refundedAmount: true, status: true },
  });
  return payments.reduce<ManualPaymentTotals>((totals, payment) => {
    const amount = toMoney(payment.amount);
    const refunded = toMoney(payment.refundedAmount);
    return {
      received: toMoney(totals.received + amount),
      refunded: toMoney(totals.refunded + refunded),
      net: toMoney(totals.net + Math.max(amount - refunded, 0)),
    };
  }, { received: 0, refunded: 0, net: 0 });
}

async function refreshManualParticipantPaymentSnapshot(
  tx: Prisma.TransactionClient,
  participant: { id: string; contaId: string; registrationFeeCharged: Prisma.Decimal; revenueEntryId: string | null },
  entryId: string,
) {
  const totals = await loadManualPaymentTotals(tx, participant.contaId, entryId);
  const expected = toMoney(participant.registrationFeeCharged);
  const status = totals.net <= 0 && totals.received > 0
    ? 'REFUNDED'
    : totals.net >= expected && expected > 0
      ? 'RECEIVED'
      : 'PENDING';
  const entry = await tx.eventFinancialEntry.update({
    where: { id: entryId },
    data: {
      actualAmount: totals.received > 0 ? decimal(totals.received) : null,
      refundedAmount: decimal(totals.refunded),
      netAmount: decimal(totals.net),
      status,
      realizedAt: totals.received > 0 ? new Date() : null,
      refundedAt: totals.refunded > 0 ? new Date() : null,
    },
  });
  const updatedParticipant = await tx.eventParticipant.update({
    where: { id: participant.id },
    data: {
      isFeePaid: status === 'RECEIVED',
      feePaidAmount: decimal(totals.net),
      feeRefundedAmount: decimal(totals.refunded),
      entryAmount: decimal(totals.net),
      balanceAmount: decimal(Math.max(expected - totals.net, 0)),
      financialStatusSnapshot: status === 'RECEIVED'
        ? 'QUITADO'
        : status === 'REFUNDED'
          ? 'ESTORNADO'
          : totals.net > 0
              ? 'EM_DIA'
              : 'PENDENTE',
    },
  });
  return { entry, participant: updatedParticipant, totals };
}

export async function createManualEventParticipantPayment(
  ctx: EventsContext,
  eventId: string,
  participantId: string,
  input: ManualEventParticipantPaymentInput,
) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: { event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertOperationalEvent(participant.event.status);
    if (participant.billingMode !== 'FULL' || participant.asaasPaymentId || participant.asaasInstallmentId) {
      throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A baixa manual está disponível apenas para inscrições manuais.', 409);
    }

    const amount = toMoney(input.amount);
    const expected = toMoney(participant.registrationFeeCharged);
    if (amount <= 0) throw new EventsError('VALOR_INVALIDO', 'Informe um valor maior que zero.', 422);

    let entryId = participant.revenueEntryId;
    if (entryId) {
      const entry = await tx.eventFinancialEntry.findFirst({ where: { id: entryId, contaId: ctx.contaId } });
      if (!entry) entryId = null;
      if (entry?.asaasPaymentId || entry?.paymentProvider === 'ASAAS') {
        throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A inscrição possui uma cobrança gerenciada pelo Asaas.', 409);
      }
    }
    if (!entryId) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: decimal(expected),
          grossAmount: decimal(toMoney(participant.registrationFeeOriginal)),
          discountAmount: decimal(toMoney(participant.registrationFeeDiscount)),
          status: 'PENDING',
          dueDate: new Date(),
          paymentMethod: null,
        },
      });
      entryId = entry.id;
      await tx.eventParticipant.update({ where: { id: participant.id }, data: { revenueEntryId: entryId } });
    }

    const totalsBefore = await loadManualPaymentTotals(tx, ctx.contaId, entryId);
    const remaining = toMoney(Math.max(expected - totalsBefore.net, 0));
    if (amount > remaining) {
      throw new EventsError('VALOR_ACIMA_DO_SALDO', `O valor máximo para baixa é ${remaining.toFixed(2)}.`, 422);
    }

    const payment = await tx.eventFinancialPayment.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        financialEntryId: entryId,
        participantId: participant.id,
        amount: decimal(amount),
        paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        paidAt: input.paidAt ?? new Date(),
        notes: input.notes,
        netAmount: decimal(amount),
        createdByUserId: ctx.userId,
      },
    });
    const refreshed = await refreshManualParticipantPaymentSnapshot(tx, { ...participant, contaId: ctx.contaId }, entryId);
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.manual_payment.create',
      entityType: 'EventFinancialPayment',
      entityId: payment.id,
      eventId,
      before: { participant, totals: totalsBefore },
      after: { payment, participant: refreshed.participant, totals: refreshed.totals },
    });
    return { payment, ...refreshed };
  });
}

export async function refundManualEventParticipantPayment(ctx: EventsContext, eventId: string, participantId: string, paymentId: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.eventFinancialPayment.findFirst({
      where: { id: paymentId, participantId, eventId, contaId: ctx.contaId },
      include: { participant: true },
    });
    if (!payment?.participant) throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento manual não encontrado.', 404);
    if (payment.status === 'REFUNDED') throw new EventsError('PAGAMENTO_JA_ESTORNADO', 'Este pagamento já foi estornado.', 409);

    const updatedPayment = await tx.eventFinancialPayment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundedAmount: payment.amount, netAmount: decimal(0) },
    });
    const refreshed = await refreshManualParticipantPaymentSnapshot(tx, { ...payment.participant, contaId: ctx.contaId }, payment.financialEntryId);
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.manual_payment.refund',
      entityType: 'EventFinancialPayment',
      entityId: payment.id,
      eventId,
      before: payment,
      after: { payment: updatedPayment, participant: refreshed.participant, entry: refreshed.entry },
    });
    return { payment: updatedPayment, ...refreshed };
  });
}

export async function deleteManualEventParticipantPayment(ctx: EventsContext, eventId: string, participantId: string, paymentId: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.eventFinancialPayment.findFirst({
      where: { id: paymentId, participantId, eventId, contaId: ctx.contaId },
      include: { participant: true },
    });
    if (!payment?.participant) throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento manual não encontrado.', 404);
    if (!['RECEIVED', 'REFUNDED'].includes(payment.status)) {
      throw new EventsError('EXCLUSAO_PAGAMENTO_BLOQUEADA', 'Este pagamento não pode ser excluído.', 409);
    }

    const totalsBefore = await loadManualPaymentTotals(tx, ctx.contaId, payment.financialEntryId);
    await tx.eventFinancialPayment.delete({ where: { id: payment.id } });
    const refreshed = await refreshManualParticipantPaymentSnapshot(tx, { ...payment.participant, contaId: ctx.contaId }, payment.financialEntryId);
    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.manual_payment.delete',
      entityType: 'EventFinancialPayment',
      entityId: payment.id,
      eventId,
      before: { payment, totals: totalsBefore },
      after: { participant: refreshed.participant, totals: refreshed.totals },
    });
    return { paymentId: payment.id, ...refreshed };
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
  charges: any[],
  isFeeExempt = false,
  manualPayments: Array<{ status?: string | null; amount?: number | string | null; refundedAmount?: number | string | null }> = [],
) {
  const manualEntryAmount = entry?.actualAmount == null ? 0 : toMoney(entry.actualAmount);
  const resolvedCharges = manualPayments.length > 0 && !entry?.asaasPaymentId
    ? [
        ...manualPayments.map((payment) => ({
          status: payment.status === 'REFUNDED' ? 'REFUNDED' : 'RECEIVED_IN_CASH',
          value: payment.amount,
          refundedValue: payment.refundedAmount,
        })),
        ...charges,
      ]
    : manualEntryAmount > 0 && !entry?.asaasPaymentId
    ? [
        {
          status: entry.status === 'REFUNDED' ? 'REFUNDED' : 'RECEIVED_IN_CASH',
          value: manualEntryAmount,
          refundedValue: entry.refundedAmount,
        },
        ...charges,
      ]
    : charges;
  const resolution = resolveEventParticipantPayment({
    expectedAmount: registrationFeeCharged,
    paidFallback: isFeePaid,
    cancelled: entry?.status === 'CANCELLED',
    refunded: entry?.status === 'REFUNDED',
    isExempt: isFeeExempt,
    charges: resolvedCharges,
  });

  return {
    percentPaid: resolution.percentPaid,
    status: resolution.status,
    totalPaid: resolution.paidAmount,
    totalRefunded: resolution.refundedAmount,
    netPaid: resolution.netPaidAmount,
  };
}

function allocateChargesToParticipant(charges: any[], participantBalance: number, groupBalance: number) {
  const ratio = groupBalance > 0 ? Math.min(Math.max(participantBalance / groupBalance, 0), 1) : 0;
  return charges.map((charge) => ({
    ...charge,
    value: charge.value == null ? charge.value : toMoney(Number(charge.value) * ratio),
    paidValue: charge.paidValue == null ? charge.paidValue : toMoney(Number(charge.paidValue) * ratio),
    amount: charge.amount == null ? charge.amount : toMoney(Number(charge.amount) * ratio),
    refundedValue: charge.refundedValue == null ? charge.refundedValue : toMoney(Number(charge.refundedValue) * ratio),
  }));
}

async function loadEventBillingGroupCharges(
  db: DbClient,
  contaId: string,
  groups: Array<{ id: string; standaloneChargeId: string | null; asaasPaymentId: string | null; asaasInstallmentId: string | null }>,
) {
  if (groups.length === 0) return new Map<string, any[]>();

  const standaloneIds = groups.map((group) => group.standaloneChargeId).filter((id): id is string => Boolean(id));
  const paymentIds = groups.flatMap((group) => [group.asaasPaymentId, group.asaasInstallmentId]).filter((id): id is string => Boolean(id));
  const [directCharges, plans] = await Promise.all([
    standaloneIds.length > 0 || paymentIds.length > 0
      ? db.charge.findMany({
          where: {
            contaId,
            OR: [
              ...(standaloneIds.length > 0 ? [{ id: { in: standaloneIds } }, { standaloneInstallmentPlanId: { in: standaloneIds } }] : []),
              ...(paymentIds.length > 0 ? [{ asaasPaymentId: { in: paymentIds } }] : []),
            ],
          },
        })
      : [],
    standaloneIds.length > 0 || paymentIds.length > 0
      ? db.standaloneInstallmentPlan.findMany({
          where: {
            contaId,
            OR: [
              ...(standaloneIds.length > 0 ? [{ id: { in: standaloneIds } }] : []),
              ...(paymentIds.length > 0 ? [{ asaasInstallmentId: { in: paymentIds } }] : []),
            ],
          },
          include: { charges: true },
        })
      : [],
  ]);

  const chargesByGroup = new Map<string, any[]>();
  for (const group of groups) {
    const planIds = plans
      .filter((plan) => plan.id === group.standaloneChargeId || plan.asaasInstallmentId === group.asaasInstallmentId)
      .map((plan) => plan.id);
    const charges = [
      ...directCharges.filter((charge) =>
        charge.id === group.standaloneChargeId
        || charge.standaloneInstallmentPlanId && planIds.includes(charge.standaloneInstallmentPlanId)
        || charge.asaasPaymentId && charge.asaasPaymentId === group.asaasPaymentId,
      ),
      ...plans.filter((plan) => planIds.includes(plan.id)).flatMap((plan) => plan.charges),
    ];
    const seen = new Set<string>();
    chargesByGroup.set(group.id, charges.filter((charge) => {
      if (seen.has(charge.id)) return false;
      seen.add(charge.id);
      return true;
    }));
  }
  return chargesByGroup;
}

async function buildParticipantPaymentSnapshots(
  ctx: Pick<EventsContext, 'contaId'>,
  records: Pick<SchoolEventRecord, 'participants' | 'financialEntries'>[],
): Promise<Map<string, ParticipantPaymentSnapshot>> {
  const participants = records.flatMap((record) => record.participants);
  const entryById = new Map(records.flatMap((record) => record.financialEntries.map((entry) => [entry.id, entry])));
  const feeParticipants = participants.filter((participant) =>
    participant.revenueEntryId || participant.asaasPaymentId || participant.asaasInstallmentId,
  );
  const asaasPaymentIds = feeParticipants
    .flatMap((participant) => [
      entryById.get(participant.revenueEntryId ?? '')?.asaasPaymentId,
      participant.asaasPaymentId,
      participant.asaasInstallmentId,
    ])
    .filter((id): id is string => Boolean(id));

  const snapshots = new Map<string, ParticipantPaymentSnapshot>();
  if (feeParticipants.length === 0) return snapshots;

  const billingGroupIds = [...new Set(feeParticipants.map((participant) => participant.billingGroupId).filter((id): id is string => Boolean(id)))];
  const billingGroups = billingGroupIds.length > 0
    ? await prisma.eventBillingGroup.findMany({ where: { contaId: ctx.contaId, id: { in: billingGroupIds } }, select: { id: true, standaloneChargeId: true, asaasPaymentId: true, asaasInstallmentId: true, balanceAmount: true } })
    : [];
  const billingGroupById = new Map(billingGroups.map((group) => [group.id, group]));
  const billingGroupCharges = await loadEventBillingGroupCharges(prisma, ctx.contaId, billingGroups);

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

    const group = participant.billingGroupId ? billingGroupById.get(participant.billingGroupId) : undefined;
    const asaasPaymentId = entry?.asaasPaymentId ?? participant.asaasPaymentId ?? participant.asaasInstallmentId;
    let participantCharges: any[] = [];

    if (group) {
      participantCharges = allocateChargesToParticipant(
        billingGroupCharges.get(group.id) ?? [],
        participant.balanceAmount.toNumber(),
        group.balanceAmount.toNumber(),
      );
    } else if (asaasPaymentId) {
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
      participant.isFeeExempt,
    );
    const entryPayment = entry
      ? calculateParticipantPayment(
          entry.expectedAmount.toNumber(),
          ['RECEIVED', 'PAID'].includes(entry.status),
          entry,
          [],
        )
      : null;
    const snapshotPayment = participant.billingMode === 'ENTRY_INSTALLMENT' && entryPayment
      ? entryPayment
      : payment;
    const realizedAt = participant.billingMode === 'ENTRY_INSTALLMENT' && entry
      ? entry.realizedAt
      : participantCharges
        .filter((charge) => ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'].includes(charge.status))
        .sort((a, b) => b.statusUpdatedAt.getTime() - a.statusUpdatedAt.getTime())[0]?.statusUpdatedAt ?? null;

    snapshots.set(participant.revenueEntryId ?? participant.id, {
      percentPaid: snapshotPayment.percentPaid,
      financialStatus: snapshotPayment.status,
      totalPaid: snapshotPayment.totalPaid,
      totalRefunded: snapshotPayment.totalRefunded,
      netPaid: snapshotPayment.netPaid,
      realizedAt,
      entryStatus: financialEntryStatusFromParticipantStatus(snapshotPayment.status),
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

  const billingGroupIds = [...new Set(participants.map((participant) => participant.billingGroupId).filter((id): id is string => Boolean(id)))];
  const billingGroups = billingGroupIds.length > 0
    ? await prisma.eventBillingGroup.findMany({ where: { contaId: ctx.contaId, id: { in: billingGroupIds } }, select: { id: true, standaloneChargeId: true, asaasPaymentId: true, asaasInstallmentId: true, balanceAmount: true } })
    : [];
  const billingGroupById = new Map(billingGroups.map((group) => [group.id, group]));
  const billingGroupCharges = await loadEventBillingGroupCharges(prisma, ctx.contaId, billingGroups);

  const asaasPaymentIds = financialEntries
    .map((e) => e.asaasPaymentId)
    .filter((id): id is string => Boolean(id));
  asaasPaymentIds.push(
    ...participants
      .flatMap((participant) => [participant.asaasPaymentId, participant.asaasInstallmentId])
      .filter((id): id is string => Boolean(id)),
  );

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
  const participantSortData = new Map<string, { status: string; dueDate: Date | null; createdAt: Date }>();
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
    const billingGroup = part.billingGroupId ? billingGroupById.get(part.billingGroupId) : undefined;
    const asaasPaymentId = entry?.asaasPaymentId ?? part.asaasInstallmentId ?? part.asaasPaymentId;
    let participantCharges: any[] = [];

    if (billingGroup) {
      participantCharges = allocateChargesToParticipant(
        billingGroupCharges.get(billingGroup.id) ?? [],
        part.balanceAmount.toNumber(),
        billingGroup.balanceAmount.toNumber(),
      );
    } else if (asaasPaymentId) {
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
      participantCharges,
      part.isFeeExempt
    );
    participantSortData.set(part.id, {
      status: part.cancelledAt ? 'CANCELADO' : paymentDetails.status,
      dueDate: participantDueDate(entry, participantCharges),
      createdAt: part.createdAt,
    });
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
      registrationFeeOriginal: part.registrationFeeOriginal.toNumber(),
      registrationFeeDiscount: part.registrationFeeDiscount.toNumber(),
      registrationFeeDiscountType: part.registrationFeeDiscountType,
      billingMode: part.billingMode,
      entryAmount: part.entryAmount.toNumber(),
      balanceAmount: part.balanceAmount.toNumber(),
      entryPaymentMethod: part.entryPaymentMethod,
      billingGroupId: part.billingGroupId,
      isFeePaid: part.isFeePaid,
      isFeeExempt: part.isFeeExempt,
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

  return participantData.sort((a, b) => {
    const aSort = participantSortData.get(a.id);
    const bSort = participantSortData.get(b.id);
    const priorityDifference = participantStatusPriority(aSort?.status) - participantStatusPriority(bSort?.status);
    if (priorityDifference !== 0) return priorityDifference;

    const aDueDate = aSort?.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDueDate = bSort?.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDueDate !== bDueDate && participantStatusPriority(aSort?.status) <= 3) return aDueDate - bDueDate;

    return (bSort?.createdAt.getTime() ?? 0) - (aSort?.createdAt.getTime() ?? 0);
  });
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

    // EventoContrato intentionally uses RESTRICT for indirect deletions
    // (participant/student), but deleting an event is an explicit destructive
    // action that also promises to remove all event-owned data. Remove the
    // contracts first so their RESTRICT foreign key does not block the event.
    // Their documents and evidences are removed by their own CASCADE links.
    await tx.eventoContrato.deleteMany({
      where: { contaId: ctx.contaId, eventId },
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

    const seatedSaleCount = await tx.eventTicketSaleSeat.count({
      where: { contaId: ctx.contaId, saleId },
    });
    if (seatedSaleCount > 0 && (input.lotId != null || input.quantity != null)) {
      throw new EventsError(
        'VENDA_ASSENTO_BLOQUEADA',
        'Vendas com assentos numerados não podem ter lote ou quantidade alterados. Cancele e registre novamente.',
        409,
      );
    }

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

    const targetAlunoId = input.alunoId === undefined ? current.alunoId : input.alunoId;
    const targetResponsavelId =
      input.responsavelId === undefined ? current.responsavelId : input.responsavelId;

    await assertEventScopedTicketSaleLinks(tx, ctx.contaId, current.eventId, {
      alunoId: targetAlunoId,
      responsavelId: targetResponsavelId,
    });

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

    const { releaseSeatsForTicketSale } = await import('./map/staff-map-sales.service');
    await releaseSeatsForTicketSale(tx, ctx.contaId, saleId);

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

    // Historical sections from archived maps do not represent an operational
    // dependency. They are kept for audit/history, and the lot FK is SET NULL
    // when the lot is deleted. Only active/draft maps must block deletion.
    const sectionsCount = await tx.eventMapSection.count({
      where: {
        contaId: ctx.contaId,
        lotId,
        map: { status: { not: 'ARCHIVED' } },
      },
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
