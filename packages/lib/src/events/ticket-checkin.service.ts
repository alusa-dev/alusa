import { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../prisma';
import { EventsError } from './events.service';
import { isTicketPaymentBlocked } from './ticket-payment-eligibility';
import { normalizeCheckInCode, toCheckInCode } from './map/ticket-code';

export { isTicketPaymentBlocked } from './ticket-payment-eligibility';
export { isEventMapOrderRefundFinalized } from './ticket-payment-eligibility';

type DbClient = PrismaClient | Prisma.TransactionClient;

const ticketInclude = {
  event: {
    select: {
      id: true,
      name: true,
      status: true,
      startsAt: true,
    },
  },
  order: {
    select: {
      id: true,
      buyerName: true,
      buyerEmail: true,
      status: true,
      paymentStatus: true,
    },
  },
  orderItem: {
    select: {
      sectionName: true,
      seatLabel: true,
      technicalCode: true,
    },
  },
  sale: {
    select: {
      id: true,
      buyerName: true,
      buyerEmail: true,
      status: true,
    },
  },
  saleSeat: {
    select: {
      sectionName: true,
      seatLabel: true,
      technicalCode: true,
    },
  },
} as const satisfies Prisma.EventTicketInclude;

type EventTicketWithCheckInRelations = Prisma.EventTicketGetPayload<{ include: typeof ticketInclude }>;

export type EventTicketCheckInResult = {
  ticketId: string;
  ticketCode: string;
  status: EventTicketWithCheckInRelations['status'];
  usedAt: string | null;
  order: EventTicketWithCheckInRelations['order'];
  sale: EventTicketWithCheckInRelations['sale'];
  seat: {
    sectionName: string;
    seatLabel: string;
    technicalCode: string;
  } | null;
};

export type EventTicketCheckInEvent = {
  id: string;
  name: string;
  status: EventTicketWithCheckInRelations['event']['status'];
  startsAt: string;
};

export async function listEventTicketCheckIns(
  contaId: string,
  eventId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const page = Math.min(1_000, Math.max(1, Math.floor(options.page ?? 1)));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const where = { contaId, eventId, status: 'USED' as const };
  const [tickets, total] = await Promise.all([prisma.eventTicket.findMany({
    where,
    orderBy: [{ usedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      usedAt: true,
      order: { select: { buyerName: true, buyerEmail: true, map: { select: { name: true } } } },
      orderItem: { select: { sectionName: true, seatLabel: true } },
      sale: { select: { buyerName: true, buyerEmail: true, lot: { select: { name: true } } } },
      saleSeat: { select: { sectionName: true, seatLabel: true } },
    },
  }), prisma.eventTicket.count({ where })]);
  if (tickets.length === 0) return { items: [], total, page, pageSize };

  const audits = await prisma.eventAudit.findMany({
    where: {
      contaId,
      eventId,
      entityType: 'EventTicket',
      entityId: { in: tickets.map((ticket) => ticket.id) },
      action: { in: ['events.ticket.check_in', 'events.map.ticket.check_in'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, actor: { select: { nome: true } } },
  });
  const operators = new Map<string, string>();
  for (const audit of audits) if (!operators.has(audit.entityId) && audit.actor?.nome) operators.set(audit.entityId, audit.actor.nome);

  const items = tickets.map((ticket) => {
    const seat = ticket.orderItem ?? ticket.saleSeat;
    return {
      id: ticket.id,
      buyerName: ticket.order?.buyerName ?? ticket.sale?.buyerName ?? 'Comprador não identificado',
      buyerEmail: ticket.order?.buyerEmail ?? ticket.sale?.buyerEmail ?? null,
      sessionName: ticket.order?.map?.name ?? null,
      lotName: ticket.sale?.lot.name ?? null,
      seatLabel: seat ? [seat.sectionName, seat.seatLabel].filter(Boolean).join(' · ') : null,
      usedAt: ticket.usedAt?.toISOString() ?? null,
      operatorName: operators.get(ticket.id) ?? null,
    };
  });
  return { items, total, page, pageSize };
}

export function assertEventAllowsCheckIn(status: EventTicketCheckInEvent['status']) {
  if (status === 'CANCELLED' || status === 'ARCHIVED') {
    throw new EventsError('EVENTO_INDISPONIVEL', 'Não é possível registrar entradas neste evento.', 409);
  }
}

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function mapTicket(ticket: EventTicketWithCheckInRelations): EventTicketCheckInResult {
  const seat = ticket.orderItem
    ? {
        sectionName: ticket.orderItem.sectionName,
        seatLabel: ticket.orderItem.seatLabel,
        technicalCode: ticket.orderItem.technicalCode,
      }
    : ticket.saleSeat
      ? {
          sectionName: ticket.saleSeat.sectionName,
          seatLabel: ticket.saleSeat.seatLabel,
          technicalCode: ticket.saleSeat.technicalCode,
        }
      : null;

  return {
    ticketId: ticket.id,
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    usedAt: ticket.usedAt?.toISOString() ?? null,
    order: ticket.order,
    sale: ticket.sale,
    seat,
  };
}

async function findTicket(
  db: DbClient,
  contaId: string,
  eventId: string,
  ticketCode: string,
) {
  const normalized = ticketCode.trim().toUpperCase();
  if (!normalized) {
    throw new EventsError('CODIGO_INVALIDO', 'Informe o código do ingresso.', 422);
  }

  const eventScope: Prisma.EventTicketWhereInput = { contaId };
  if (eventId) eventScope.eventId = eventId;

  let ticket = await db.eventTicket.findFirst({
    where: { ...eventScope, ticketCode: normalized },
    include: ticketInclude,
  });

  if (!ticket) {
    const checkInCode = normalizeCheckInCode(normalized);
    if (checkInCode) {
      ticket = await db.eventTicket.findFirst({
        where: { ...eventScope, checkInCode },
        include: ticketInclude,
      });
    }
  }

  // Os ingressos PDF legados imprimem apenas o código curto no Code 128.
  // A busca permanece limitada à conta e ao evento, e colisões são recusadas.
  if (!ticket) {
    const candidates = await db.eventTicket.findMany({
      where: eventScope,
      select: { id: true, eventId: true, ticketCode: true },
    });
    const matchingCandidates = candidates.filter((candidate) => toCheckInCode(candidate.ticketCode) === normalized);

    if (matchingCandidates.length > 1) {
      throw new EventsError(
        'CODIGO_AMBIGUO',
        'Não conseguimos identificar este ingresso. Use uma versão atualizada para tentar novamente.',
        409,
      );
    }

    const candidate = matchingCandidates[0];
    if (candidate) {
      ticket = await db.eventTicket.findFirst({
        where: { id: candidate.id, ...eventScope },
        include: ticketInclude,
      });
    }
  }

  return ticket;
}

export async function verifyEventTicketForCheckIn(contaId: string, eventId: string, ticketCode: string) {
  const ticket = await findTicket(prisma, contaId, eventId, ticketCode);
  if (!ticket) throw new EventsError('INGRESSO_NAO_ENCONTRADO', 'Ingresso não encontrado para este evento.', 404);
  assertEventAllowsCheckIn(ticket.event.status);
  return mapTicket(ticket);
}

export async function verifyEventTicketForCheckInAcrossEvents(contaId: string, ticketCode: string) {
  const ticket = await findTicket(prisma, contaId, '', ticketCode);
  if (!ticket) throw new EventsError('INGRESSO_NAO_ENCONTRADO', 'Ingresso não encontrado.', 404);
  assertEventAllowsCheckIn(ticket.event.status);

  return {
    event: {
      id: ticket.event.id,
      name: ticket.event.name,
      status: ticket.event.status,
      startsAt: ticket.event.startsAt.toISOString(),
    } satisfies EventTicketCheckInEvent,
    ticket: mapTicket(ticket),
  };
}

export async function markEventTicketUsed(
  contaId: string,
  eventId: string,
  ticketCode: string,
  actorUserId: string,
  options: { requireSeat?: boolean; auditAction?: string } = {},
) {
  const verified = await verifyEventTicketForCheckIn(contaId, eventId, ticketCode);

  if (options.requireSeat && !verified.seat) {
    throw new EventsError('INGRESSO_INVALIDO', 'Ingresso sem assento vinculado.', 409);
  }
  if (verified.status === 'USED') {
    return { ok: true as const, alreadyUsed: true, ticket: verified };
  }
  if (verified.status !== 'VALID') {
    throw new EventsError('INGRESSO_INVALIDO', 'Ingresso não pode ser utilizado.', 409);
  }
  if (verified.order && verified.order.status !== 'CONFIRMED') {
    throw new EventsError('PEDIDO_NAO_CONFIRMADO', 'Pedido do ingresso não está confirmado.', 409);
  }
  if (verified.order && isTicketPaymentBlocked(verified.order.paymentStatus)) {
    throw new EventsError('PAGAMENTO_EM_ANALISE', 'Ingresso bloqueado enquanto o pagamento está em análise.', 409);
  }
  if (verified.sale && !['PAID', 'COMPLIMENTARY'].includes(verified.sale.status)) {
    throw new EventsError('VENDA_NAO_CONFIRMADA', 'Venda do ingresso não está confirmada.', 409);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (verified.order) {
      // Serialize check-in with refund/dispute transitions, which update the
      // same tenant-scoped order row. The provider event remains authoritative.
      await tx.$queryRaw`SELECT id FROM "EventMapOrder" WHERE id = ${verified.order.id} AND "contaId" = ${contaId} FOR UPDATE`;
      const order = await tx.eventMapOrder.findFirst({
        where: { id: verified.order.id, contaId },
        select: { status: true, paymentStatus: true },
      });
      if (!order || order.status !== 'CONFIRMED' || isTicketPaymentBlocked(order.paymentStatus)) {
        throw new EventsError('PAGAMENTO_EM_ANALISE', 'Ingresso bloqueado enquanto o pagamento está em análise.', 409);
      }
    }

    const result = await tx.eventTicket.updateMany({
      where: { id: verified.ticketId, contaId, eventId, status: 'VALID' },
      data: { status: 'USED', usedAt: now },
    });

    if (result.count !== 1) return false;

    await tx.auditLog.create({
      data: {
        contaId,
        actorType: 'USER',
        actorId: actorUserId,
        action: options.auditAction ?? 'events.ticket.check_in',
        entityType: 'EventTicket',
        entityId: verified.ticketId,
        metadata: toAuditJson({
          eventId,
          orderId: verified.order?.id ?? verified.sale?.id ?? null,
          ticketCode: verified.ticketCode,
        }),
      },
    });

    await tx.eventAudit.create({
      data: {
        contaId,
        eventId,
        actorUserId,
        action: options.auditAction ?? 'events.ticket.check_in',
        entityType: 'EventTicket',
        entityId: verified.ticketId,
        metadata: toAuditJson({
          orderId: verified.order?.id ?? verified.sale?.id ?? null,
          ticketCode: verified.ticketCode,
          seatLabel: verified.seat?.seatLabel ?? null,
        }),
      },
    });

    return true;
  });

  if (!updated) {
    const current = await verifyEventTicketForCheckIn(contaId, eventId, verified.ticketCode);
    if (current.status === 'USED') return { ok: true as const, alreadyUsed: true, ticket: current };
    throw new EventsError('INGRESSO_INVALIDO', 'Ingresso não pode ser utilizado.', 409);
  }

  return {
    ok: true as const,
    alreadyUsed: false,
    ticket: {
      ...verified,
      status: 'USED' as const,
      usedAt: now.toISOString(),
    },
  };
}

export async function markEventTicketUsedAcrossEvents(
  contaId: string,
  ticketCode: string,
  actorUserId: string,
  options: { requireSeat?: boolean; auditAction?: string } = {},
) {
  const resolved = await verifyEventTicketForCheckInAcrossEvents(contaId, ticketCode);
  const result = await markEventTicketUsed(
    contaId,
    resolved.event.id,
    resolved.ticket.ticketCode,
    actorUserId,
    options,
  );
  return { ...result, event: resolved.event };
}
