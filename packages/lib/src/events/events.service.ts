import { buildEventParticipantRemovalDecision } from './event-participant-removal-decision.service';
export { getEventParticipantRemovalDecision } from './event-participant-removal-decision.service';
import { eventParticipantScalarSelect, mapFinancialEntry, mapTicketSale } from './event-financial-read-models';
import { recordEventAudit } from './event-audit.service';
export { eventParticipantScalarSelect, mapFinancialEntry, mapTicketSale } from './event-financial-read-models';
export { recordEventAudit } from './event-audit.service';
import { Prisma, PrismaClient, EventFinancialEntryStatus } from '@prisma/client';

import {
  EventsError,
  buildStaffSaleTicketsUrl,
  calculateEventMetrics,
  resolveEventParticipantPayment,
  validateCostumeAssignmentStatusTransition,
  validateSchoolEventStatusTransition,
  validateTicketLotStatusTransition,
  type EventMetrics,
} from '@alusa/domain/events';

export { EventsError } from '@alusa/domain/events';

import { prisma } from '../prisma';
import {
  convergeStandaloneInstallmentPlanStatus,
  listStandaloneInstallmentPlanIdsForParticipant,
} from '../services/standalone-installment-plan-status.service';
import {
  assertEventScopedAssignmentLinks,
  listEventScopedResources,
  type EventScopedResources,
} from './event-participant-scope';
import type {
  CreateCostumeAssignmentInput,
  CreateCostumeInput,
  CreateSchoolEventInput,
  CreateTicketLotInput,
  ListSchoolEventsQuery,
  UpdateCostumeAssignmentInput,
  UpdateCostumeInput,
  UpdateSchoolEventInput,
  UpdateTicketLotInput,
  ListEventParticipantsQuery,
} from './events.schema';
import {
  eventPaymentRulesFromRecord,
  eventPaymentRulesToPersistence,
  normalizeEventPaymentRules,
} from './events-payment-rules';

type DbClient = PrismaClient | Prisma.TransactionClient;

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
  // Ticket artwork is optional and tenant-owned through SchoolEvent.
  ticketSales: true,
  costumes: true,
  assignments: true,
  financialEntries: true,
  // Keep this projection explicit so an out-of-date generated client cannot
  // expand the relation with columns that are not present in the database.
  participants: {
    select: {
      ...eventParticipantScalarSelect,
    },
  },
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
  record: Pick<SchoolEventRecord, 'ticketSales' | 'ticketLots' | 'financialEntries' | 'assignments' | 'costumes' | 'participants'>,
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
      id: entry.id,
      type: entry.type,
      status: entry.status,
      expectedAmount: toMoney(entry.expectedAmount),
      grossAmount: entry.grossAmount == null ? null : toMoney(entry.grossAmount),
      discountAmount: entry.discountAmount == null ? null : toMoney(entry.discountAmount),
      netAmount: entry.netAmount == null ? null : toMoney(entry.netAmount),
      actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
      refundedAmount: entry.refundedAmount == null ? null : toMoney(entry.refundedAmount),
      originType: entry.originType,
      originId: entry.originId,
      costClass: entry.costClass,
      category: entry.category,
    })),
    costumeAssignments: record.assignments.map((assignment) => ({
      status: assignment.status,
      billingMode: assignment.billingMode,
      chargedValue: assignment.chargedValue == null ? null : toMoney(assignment.chargedValue),
      isPaid: assignment.isPaid,
    })),
    costumes: record.costumes.map((costume) => ({
      id: costume.id,
      schoolCost: toMoney(costume.schoolCost),
      quantity: costume.quantity,
    })),
    participantObligations: record.participants.map((participant) => {
      const snapshot = paymentSnapshots?.get(participant.revenueEntryId ?? participant.id);
      return {
        id: participant.id,
        revenueEntryId: participant.revenueEntryId,
        grossAmount: toMoney(participant.registrationFeeOriginal) || toMoney(participant.registrationFeeCharged),
        discountAmount: toMoney(participant.registrationFeeDiscount),
        expectedAmount: toMoney(participant.registrationFeeCharged),
        actualAmount: snapshot?.totalPaid
          ?? (toMoney(participant.feePaidAmount) > 0
            ? toMoney(participant.feePaidAmount)
            : participant.isFeePaid ? toMoney(participant.registrationFeeCharged) : null),
        refundedAmount: snapshot?.totalRefunded ?? toMoney(participant.feeRefundedAmount),
        isExempt: participant.isFeeExempt,
        cancelled: Boolean(participant.cancelledAt),
      };
    }),
  });
}

export function mapSchoolEvent(record: SchoolEventRecord, paymentSnapshots?: Map<string, ParticipantPaymentSnapshot>) {
  const metrics = buildMetrics(record, paymentSnapshots);

  return {
    id: record.id,
    contaId: record.contaId,
    name: record.name,
    ticketArtworkUrl: record.ticketArtworkUrl,
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

/**
 * Finalizar um evento encerra novas vendas de ingressos. O finishedAt é
 * preservado quando o evento é reativado para que essa regra não seja perdida.
 */
export function assertEventTicketSalesOpen(event: { status: string; finishedAt: Date | null }) {
  assertOperationalEvent(event.status);
  if (event.finishedAt) {
    throw new EventsError(
      'VENDAS_INGRESSOS_ENCERRADAS',
      'As vendas de ingressos foram encerradas para este evento.',
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

export type EventFinancialConsistencyReport = {
  eventId: string;
  contaId: string;
  isConsistent: boolean;
  issues: Array<{ code: string; message: string; difference?: number }>;
  totals: {
    activeParticipantGross: number;
    activeParticipantDiscount: number;
    activeParticipantExpected: number;
    linkedEntryExpected: number;
    activeParticipantReceived: number;
  };
};

function moneyDifference(left: number, right: number) {
  return toMoney(Math.abs(left - right));
}

/**
 * Read-only reconciliation for the event summary. This intentionally does
 * not repair records: financial repairs must go through their source of
 * truth (payment webhook or an audited administrative command).
 */
export async function inspectEventFinancialConsistency(
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
): Promise<EventFinancialConsistencyReport> {
  const record = await getEventRecordOrThrow(ctx.contaId, eventId);
  const paymentSnapshots = await buildParticipantPaymentSnapshots(ctx, [record]);
  const activeParticipants = record.participants.filter((participant) => !participant.cancelledAt);
  const linkedEntryIds = new Set<string>();
  const issues: EventFinancialConsistencyReport['issues'] = [];

  let activeParticipantGross = 0;
  let activeParticipantDiscount = 0;
  let activeParticipantExpected = 0;
  let activeParticipantReceived = 0;
  let linkedEntryExpected = 0;

  for (const participant of activeParticipants) {
    const expected = toMoney(participant.registrationFeeCharged);
    const gross = toMoney(participant.registrationFeeOriginal) || toMoney(participant.registrationFeeCharged);
    const discount = toMoney(participant.registrationFeeDiscount);
    activeParticipantGross += gross;
    activeParticipantDiscount += discount;
    activeParticipantExpected += expected;

    const snapshot = paymentSnapshots.get(participant.revenueEntryId ?? participant.id);
    activeParticipantReceived += snapshot?.netPaid ?? 0;

    if (expected <= 0 || participant.isFeeExempt) continue;
    if (!participant.revenueEntryId) {
      issues.push({
        code: 'PARTICIPANT_WITHOUT_REVENUE_ENTRY',
        message: `A inscrição ${participant.id} não possui lançamento de receita local.`,
      });
      continue;
    }

    if (linkedEntryIds.has(participant.revenueEntryId)) continue;
    linkedEntryIds.add(participant.revenueEntryId);
    const entry = record.financialEntries.find((candidate) => candidate.id === participant.revenueEntryId);
    if (!entry) {
      issues.push({
        code: 'REVENUE_ENTRY_NOT_FOUND',
        message: `O lançamento ${participant.revenueEntryId} da inscrição ${participant.id} não foi encontrado no evento.`,
      });
      continue;
    }

    linkedEntryExpected += toMoney(entry.expectedAmount);
  }

  const expectedDifference = moneyDifference(activeParticipantExpected, linkedEntryExpected);
  if (expectedDifference > 0.01) {
    issues.push({
      code: 'PARTICIPANT_ENTRY_EXPECTED_MISMATCH',
      message: 'A soma das obrigações das inscrições diverge dos lançamentos financeiros vinculados.',
      difference: expectedDifference,
    });
  }

  const discountDifference = moneyDifference(activeParticipantGross - activeParticipantDiscount, activeParticipantExpected);
  if (discountDifference > 0.01) {
    issues.push({
      code: 'PARTICIPANT_DISCOUNT_MISMATCH',
      message: 'Valor bruto menos descontos diverge do valor líquido das inscrições.',
      difference: discountDifference,
    });
  }

  return {
    eventId,
    contaId: ctx.contaId,
    isConsistent: issues.length === 0,
    issues,
    totals: {
      activeParticipantGross: toMoney(activeParticipantGross),
      activeParticipantDiscount: toMoney(activeParticipantDiscount),
      activeParticipantExpected: toMoney(activeParticipantExpected),
      linkedEntryExpected: toMoney(linkedEntryExpected),
      activeParticipantReceived: toMoney(activeParticipantReceived),
    },
  };
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
        // Mantém o marco de finalização ao reativar, fechando novas vendas de ingressos.
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

const ticketLotInclude = {
  event: { select: { id: true, name: true, startsAt: true } },
  eventMap: { select: { id: true, name: true, startsAt: true } },
} satisfies Prisma.EventTicketLotInclude;

export function mapTicketLot(lot: Prisma.EventTicketLotGetPayload<{ include: typeof ticketLotInclude }>) {
  return {
    id: lot.id,
    contaId: lot.contaId,
    eventId: lot.eventId,
    eventMapId: lot.eventMapId,
    eventMap: lot.eventMap
      ? { ...lot.eventMap, startsAt: toIso(lot.eventMap.startsAt) }
      : null,
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
    include: ticketLotInclude,
    orderBy: [{ createdAt: 'desc' }],
  });
  return lots.map(mapTicketLot);
}

async function getTicketLotDto(db: DbClient, contaId: string, lotId: string) {
  const lot = await db.eventTicketLot.findFirst({
    where: { id: lotId, contaId },
    include: ticketLotInclude,
  });
  if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado.', 404);
  return mapTicketLot(lot);
}

export async function createTicketLot(ctx: EventsContext, input: CreateTicketLotInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertEventTicketSalesOpen(event);

    // Coordinate same-name lot creation with map creation and concurrent lot
    // edits for this event. The partial unique index remains the final guard.
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SchoolEvent"
      WHERE "id" = ${input.eventId} AND "contaId" = ${ctx.contaId}
      FOR UPDATE
    `);

    // Generic lots are event-wide. Map-owned lots may reuse the same name in
    // another session, so only event-wide lots participate in this check.
    const existing = await tx.eventTicketLot.findFirst({
      where: { contaId: ctx.contaId, eventId: input.eventId, eventMapId: null, name: input.name },
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
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SchoolEvent"
        WHERE "id" = ${current.eventId} AND "contaId" = ${ctx.contaId}
        FOR UPDATE
      `);
    }

    if (input.name && input.name !== current.name) {
      const existing = await tx.eventTicketLot.findFirst({
        where: {
          contaId: ctx.contaId,
          eventId: current.eventId,
          eventMapId: current.eventMapId,
          name: input.name,
        },
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


function mapPendingPublicOrderAsTicketSale(
  order: Prisma.EventMapOrderGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      map: { select: { name: true; startsAt: true } };
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
    event: { ...order.event, startsAt: (order.map.startsAt ?? order.event.startsAt).toISOString() },
    sessionName: order.map.name,
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
          include: { publicSeat: { select: { map: { select: { name: true } } } } },
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
        map: { select: { name: true, startsAt: true } },
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
        select: {
          id: true,
          status: true,
          accessToken: true,
          invoiceUrl: true,
          asaasPaymentId: true,
          paymentStatus: true,
          ticketFulfillmentStatus: true,
          map: { select: { name: true } },
          _count: { select: { tickets: true, items: true } },
        },
      })
    : [];
  const publicOrdersById = new Map(publicOrders.map((order) => [order.id, order]));
  const usedTicketGroups = publicOrderIds.length
    ? await prisma.eventTicket.groupBy({
        by: ['eventMapOrderId'],
        where: { contaId: ctx.contaId, eventMapOrderId: { in: publicOrderIds }, status: 'USED' },
        _count: { _all: true },
      })
    : [];
  const usedTicketCountByOrder = new Map(usedTicketGroups.map((group) => [group.eventMapOrderId, group._count._all]));

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
        ticketFulfillmentStatus: order?.ticketFulfillmentStatus ?? null,
        ticketCount: order?._count.tickets ?? 0,
        seatCount: order?._count.items ?? 0,
        ticketsUsed: usedTicketCountByOrder.get(sale.eventMapOrderId) ?? 0,
        chargeDetailUrl: order ? `/cobrancas/event-map-order:${order.id}` : dto.chargeDetailUrl,
        ticketsUrl:
          order?.status === 'CONFIRMED' && ![
            'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PAYMENT_REFUND_IN_PROGRESS', 'REFUNDED', 'PAYMENT_REFUNDED',
            'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'IN_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DISPUTE_LOST', 'CHARGEBACK',
          ].includes(order.paymentStatus ?? '')
            ? `/api/events/public-orders/${order.id}/tickets`
            : null,
        sessionName: order?.map.name ?? null,
      };
    }

    if (sale.saleSeats.length > 0) {
      return {
        ...dto,
        source: 'MANUAL_SALE' as const,
        sessionName: sale.saleSeats[0]?.publicSeat.map.name ?? null,
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

export async function listFinancialEntriesPage(
  ctx: Pick<EventsContext, 'contaId'>,
  input: {
    eventId?: string;
    type?: 'COST' | 'REVENUE';
    status?: EventFinancialEntryStatus;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  const search = input.search?.trim();
  const where = {
    contaId: ctx.contaId,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(search
      ? {
          OR: [
            { description: { contains: search, mode: 'insensitive' as const } },
            { category: { contains: search, mode: 'insensitive' as const } },
            { supplier: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, entries] = await Promise.all([
    prisma.eventFinancialEntry.count({ where }),
    prisma.eventFinancialEntry.findMany({
      where,
      include: {
        event: { select: { id: true, name: true, startsAt: true } },
        createdBy: { select: { id: true, nome: true } },
      },
      orderBy: [{ realizedAt: 'desc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    entries: entries.map(mapFinancialEntry),
    meta: pageMeta(total, page, pageSize),
  };
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


export async function removeCancelledEventParticipant(ctx: EventsContext, eventId: string, participantId: string) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    select: {
      ...eventParticipantScalarSelect,
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
      select: { id: true },
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
      select: {
        ...eventParticipantScalarSelect,
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

export function allocateChargesToParticipant(charges: any[], participantBalance: number, groupBalance: number) {
  const ratio = groupBalance > 0 ? Math.min(Math.max(participantBalance / groupBalance, 0), 1) : 0;
  return charges.map((charge) => ({
    ...charge,
    value: charge.value == null ? charge.value : toMoney(Number(charge.value) * ratio),
    paidValue: charge.paidValue == null ? charge.paidValue : toMoney(Number(charge.paidValue) * ratio),
    amount: charge.amount == null ? charge.amount : toMoney(Number(charge.amount) * ratio),
    refundedValue: charge.refundedValue == null ? charge.refundedValue : toMoney(Number(charge.refundedValue) * ratio),
  }));
}

export async function loadEventBillingGroupCharges(
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
    // ENTRY_INSTALLMENT has two payment channels: the manual entry and the
    // external balance. calculateParticipantPayment already merges both;
    // selecting only the local entry would understate what the event received
    // after the Asaas balance was settled.
    const snapshotPayment = payment;
    const realizationDates = [
      entry?.realizedAt ?? null,
      ...participantCharges
        .filter((charge) => ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'].includes(charge.status))
        .map((charge) => charge.statusUpdatedAt as Date),
    ].filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()));
    const realizedAt = realizationDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

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
    select: {
      ...eventParticipantScalarSelect,
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

export async function listEventParticipantsPage(
  ctx: Pick<EventsContext, 'contaId'>,
  eventId: string,
  input: Partial<Pick<ListEventParticipantsQuery, 'page' | 'pageSize' | 'search' | 'status'>> = {},
) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  const search = input.search?.trim();
  const where: Prisma.EventParticipantWhereInput = {
    contaId: ctx.contaId,
    eventId,
    ...(input.status === 'ACTIVE' ? { cancelledAt: null } : {}),
    ...(input.status === 'CANCELLED' ? { cancelledAt: { not: null } } : {}),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { aluno: { nome: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, participants] = await Promise.all([
    prisma.eventParticipant.count({ where }),
    prisma.eventParticipant.findMany({
      where,
      select: {
        id: true,
        eventId: true,
        alunoId: true,
        displayName: true,
        registrationFeeCharged: true,
        isFeePaid: true,
        isFeeExempt: true,
        feePaymentMethod: true,
        financialStatusSnapshot: true,
        feePaidAmount: true,
        cancelledAt: true,
        createdAt: true,
        aluno: { select: { id: true, nome: true, foto: true } },
        turma: { select: { id: true, nome: true } },
      },
      orderBy: [{ cancelledAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    participants: participants.map((participant) => {
      const registrationFee = toMoney(participant.registrationFeeCharged);
      const feePaidAmount = toMoney(participant.feePaidAmount);
      const percentPaid = participant.isFeeExempt || registrationFee <= 0
        ? 100
        : Math.min(100, Math.max(0, Math.round((feePaidAmount / registrationFee) * 100)));
      const financialStatus = participant.cancelledAt
        ? 'CANCELADO'
        : participant.isFeeExempt || registrationFee <= 0
          ? 'ISENTO'
          : participant.isFeePaid || percentPaid >= 100
            ? 'QUITADO'
            : participant.financialStatusSnapshot && participant.financialStatusSnapshot !== 'QUITADO'
              ? participant.financialStatusSnapshot
              : percentPaid > 0 ? 'PARCIAL' : 'PENDENTE';

      return {
        id: participant.id,
        eventId: participant.eventId,
        alunoId: participant.alunoId,
        displayName: participant.displayName ?? participant.aluno?.nome ?? 'Aluno não identificado',
        aluno: participant.aluno,
        turma: participant.turma,
        registrationFeeCharged: registrationFee,
        feePaidAmount,
        percentPaid,
        financialStatus,
        feePaymentMethod: participant.feePaymentMethod,
        cancelledAt: toIso(participant.cancelledAt),
        createdAt: participant.createdAt.toISOString(),
      };
    }),
    meta: pageMeta(total, page, pageSize),
  };
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
