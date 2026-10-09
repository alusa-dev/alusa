import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@alusa/database';
import { EventsError, validateTicketSaleStatusTransition } from '@alusa/domain/events';
import { assertEventTicketSalesOpen } from '@alusa/lib/events/events.service';
import { assertEventScopedTicketSaleLinks } from '@alusa/lib/events/event-participant-scope';
import { mapTicketSale } from '@alusa/lib/events/event-financial-read-models';
import { recordEventAudit } from '@alusa/lib/events/event-audit.service';
import { enqueueEventTicketEmail, buildPublicEventTicketSalePath } from '@alusa/lib/events/ticket-email-outbox';
import { createCheckInCode } from '@alusa/lib/events/map/ticket-code';
import { syncPublicLotQuantity, releaseSeatsForTicketSale } from '@alusa/lib/events/map/event-map-order-operations';
import { createSeatedTicketSale } from '@alusa/lib/events/map/staff-map-sales.service';
import type { CreateTicketSaleInput, UpdateTicketSaleInput } from '@alusa/lib/events/events.schema';

type EventsContext = { contaId: string; userId: string };
type DbClient = PrismaClient | Prisma.TransactionClient;
function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}
function decimal(value: number): Prisma.Decimal { return new Prisma.Decimal(value); }
function createPublicToken(prefix: string) { return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`; }
function assertOperationalEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED' || status === 'FINISHED') {
    throw new EventsError('EVENTO_BLOQUEADO', 'Este evento não aceita novas alterações operacionais.', 409);
  }
}
function normalizeEmail(value: string | null | undefined) { return value?.trim().toLowerCase() || null; }
async function resolveTicketBuyerEmail(db: DbClient, contaId: string, input: Pick<CreateTicketSaleInput, 'buyerEmail' | 'alunoId' | 'responsavelId'>) {
  const explicit = normalizeEmail(input.buyerEmail);
  if (explicit) return explicit;
  if (input.responsavelId) {
    const responsible = await db.responsavel.findFirst({ where: { id: input.responsavelId, contaId }, select: { email: true } });
    const email = normalizeEmail(responsible?.email);
    if (email) return email;
  }
  if (input.alunoId) {
    const student = await db.aluno.findFirst({ where: { id: input.alunoId, contaId }, select: { email: true } });
    return normalizeEmail(student?.email);
  }
  return null;
}
async function getTicketSaleDto(db: DbClient, contaId: string, saleId: string) {
  const sale = await db.eventTicketSale.findFirst({ where: { id: saleId, contaId }, include: {
    event: { select: { id: true, name: true, startsAt: true } }, lot: { select: { id: true, name: true, ticketType: true } },
    aluno: { select: { id: true, nome: true } }, responsavel: { select: { id: true, nome: true } }, createdBy: { select: { id: true, nome: true } },
  } });
  if (!sale) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  return mapTicketSale(sale);
}

export async function createTicketSale(ctx: EventsContext, input: CreateTicketSaleInput) {
  const event = await prisma.schoolEvent.findFirst({
    where: { id: input.eventId, contaId: ctx.contaId },
    select: { ticketMode: true, status: true, finishedAt: true },
  });
  if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  assertEventTicketSalesOpen(event);

  if (input.holdToken) {
    const result = await createSeatedTicketSale(ctx, { ...input, holdToken: input.holdToken });
    const primary = await getTicketSaleDto(prisma, ctx.contaId, result.primarySaleId);
    return { ...primary, groupedSaleIds: result.saleIds };
  }

  if (!input.lotId || !input.quantity) {
    throw new EventsError('DADOS_VENDA_INVALIDOS', 'Informe lote e quantidade para venda simples.', 422);
  }

  if (event.ticketMode === 'NUMBERED_SEATS') {
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
    assertEventTicketSalesOpen(lot.event);

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

    const buyerEmail = await resolveTicketBuyerEmail(tx, ctx.contaId, input);

    const unitPrice = toMoney(lot.unitPrice);
    const totalAmount = saleStatus === 'COMPLIMENTARY' ? 0 : unitPrice * quantity;
    const sale = await tx.eventTicketSale.create({
      data: {
        contaId: ctx.contaId,
        eventId: lot.eventId,
        lotId: lot.id,
        buyerName: input.buyerName,
        buyerEmail,
        accessToken: createPublicToken('sale'),
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

      await tx.eventTicketSale.updateMany({ where: { id: sale.id, contaId: ctx.contaId, eventId: input.eventId }, data: { revenueEntryId: entry.id } });
    }

    await tx.eventTicket.createMany({
      data: Array.from({ length: quantity }, () => ({
        contaId: ctx.contaId,
        eventId: lot.eventId,
        eventTicketSaleId: sale.id,
        ticketCode: createPublicToken('ticket').toUpperCase(),
        checkInCode: createCheckInCode(),
      })),
    });

    await syncPublicLotQuantity(tx, ctx.contaId, lot.id);

    if (buyerEmail && (saleStatus === 'PAID' || saleStatus === 'COMPLIMENTARY') && sale.accessToken) {
      await enqueueEventTicketEmail(tx, {
        contaId: ctx.contaId,
        purchaseId: sale.id,
        buyerEmail,
        buyerName: sale.buyerName,
        eventName: lot.event.name,
        eventStartsAt: lot.event.startsAt,
        eventLocation: [lot.event.locationName, lot.event.locationAddress].filter(Boolean).join(' — ') || null,
        ticketType: lot.name,
        ticketCount: quantity,
        ticketsPath: buildPublicEventTicketSalePath(sale.id, sale.accessToken),
      });
    }

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



export async function cancelTicketSale(ctx: EventsContext, saleId: string, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EventTicketSale" WHERE id = ${saleId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
    const current = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId } });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    const transition = validateTicketSaleStatusTransition(current.status, 'CANCELLED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const updated = await tx.eventTicketSale.updateMany({
      where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), notes: reason ?? current.notes },
    });
    if (updated.count !== 1) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    const updatedSale = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId } });
    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, eventId: current.eventId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncPublicLotQuantity(tx, ctx.contaId, current.lotId);
    await releaseSeatsForTicketSale(tx, ctx.contaId, saleId);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.ticketSale.cancel',
      entityType: 'EventTicketSale',
      entityId: saleId,
      eventId: current.eventId,
      before: current,
      after: updatedSale,
      metadata: { reason },
    });

    return getTicketSaleDto(tx, ctx.contaId, saleId);
  });
}



export async function updateTicketSale(ctx: EventsContext, saleId: string, input: UpdateTicketSaleInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EventTicketSale" WHERE id = ${saleId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
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
    for (const lockedLotId of [...new Set([current.lotId, lotId])].sort()) {
      await tx.$queryRaw`SELECT id FROM "EventTicketLot" WHERE id = ${lockedLotId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
    }
    const lot = lotId === current.lotId ? current.lot : await tx.eventTicketLot.findFirst({
      where: { id: lotId, contaId: ctx.contaId, eventId: current.eventId },
    });
    if (!lot) throw new EventsError('LOTE_NAO_ENCONTRADO', 'Lote não encontrado neste evento.', 404);

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

    const updatedResult = await tx.eventTicketSale.updateMany({
      where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
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
    if (updatedResult.count !== 1) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    const updated = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId } });

    // Sync financial entries
    if (resolvedStatus === 'COMPLIMENTARY' || totalAmount === 0) {
      // If it has financial entry, delete it
      if (current.revenueEntryId) {
        await tx.eventFinancialEntry.deleteMany({
          where: { id: current.revenueEntryId, contaId: ctx.contaId, eventId: current.eventId },
        });
        await tx.eventTicketSale.updateMany({
          where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
          data: { revenueEntryId: null },
        });
      }
    } else {
      if (current.revenueEntryId) {
        // Update existing financial entry
        const entryStatus = resolvedStatus === 'PAID' ? 'RECEIVED' : (resolvedStatus === 'CANCELLED' ? 'CANCELLED' : (resolvedStatus === 'REFUNDED' ? 'REFUNDED' : 'PENDING'));
        await tx.eventFinancialEntry.updateMany({
          where: { id: current.revenueEntryId, contaId: ctx.contaId, eventId: current.eventId },
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
        await tx.eventTicketSale.updateMany({
          where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
          data: { revenueEntryId: entry.id },
        });
      }
    }

    // Sync quantities
    await syncPublicLotQuantity(tx, ctx.contaId, current.lotId);
    if (lotId !== current.lotId) {
      await syncPublicLotQuantity(tx, ctx.contaId, lotId);
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
    await tx.$queryRaw`SELECT id FROM "EventTicketSale" WHERE id = ${saleId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
    const current = await tx.eventTicketSale.findFirst({
      where: { id: saleId, contaId: ctx.contaId },
    });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    await tx.$queryRaw`SELECT id FROM "EventTicketLot" WHERE id = ${current.lotId} AND "contaId" = ${ctx.contaId} FOR UPDATE`;

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
      await tx.eventFinancialEntry.deleteMany({
        where: { id: current.revenueEntryId, contaId: ctx.contaId, eventId: current.eventId },
      });
    }

    await releaseSeatsForTicketSale(tx, ctx.contaId, saleId);

    await tx.eventTicketSale.deleteMany({ where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId } });

    await syncPublicLotQuantity(tx, ctx.contaId, current.lotId);

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
