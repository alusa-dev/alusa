import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { eventParticipantScalarSelect } from './event-financial-read-models';
import { canRemoveEventParticipant, type EventParticipantRemovalDecision, type EventParticipantRemovalFacts } from './event-participant-lifecycle';
import { EventsError } from '@alusa/domain/events';

type DbClient = PrismaClient | Prisma.TransactionClient;
type EventsContext = { contaId: string; userId: string };
function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export type ParticipantLifecycleRecord = Prisma.EventParticipantGetPayload<{
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

export async function buildEventParticipantRemovalDecision(
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
    select: {
      ...eventParticipantScalarSelect,
      aluno: { select: { email: true } },
      responsavel: { select: { email: true } },
    },
  });

  if (!participant) {
    throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
  }

  return buildEventParticipantRemovalDecision(prisma, ctx, eventId, participant);
}
