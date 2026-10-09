import { Prisma, EventPaymentMethod } from '@prisma/client';
import { prisma } from '@alusa/database';
import {
  EventsError,
  normalizeEventFinancialLine,
  normalizeEventFinancialPayment,
  validateTicketSaleStatusTransition,
} from '@alusa/domain/events';
import { eventParticipantScalarSelect, mapFinancialEntry, mapTicketSale } from '@alusa/lib/events/event-financial-read-models';
import { recordEventAudit } from '@alusa/lib/events/event-audit.service';
import { enqueueEventTicketEmail, buildPublicEventTicketSalePath } from '@alusa/lib/events/ticket-email-outbox';
import { syncPublicLotQuantity, releaseSeatsForTicketSale } from '@alusa/lib/events/map/event-map-order-operations';
import type {
  CreateEventFinancialEntryInput,
  UpdateEventFinancialEntryInput,
  ManualEventParticipantPaymentInput,
  QuitarParticipantFeeInput,
} from '@alusa/lib/events/events.schema';

type EventsContext = { contaId: string; userId: string };

const mapToEventPaymentMethod = (method?: string | null): EventPaymentMethod => {
  if (!method) return 'OTHER';
  const allowed = ['CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER', 'COMPLIMENTARY', 'OTHER'];
  if (allowed.includes(method)) return method as EventPaymentMethod;
  return 'OTHER';
};

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
function createPublicToken(prefix: string) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}
function normalizeOptionalEmail(value: string | null | undefined) { return value?.trim().toLowerCase() || null; }
function assertFinancialAdjustmentEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED') throw new EventsError('EVENTO_BLOQUEADO', 'Este evento não aceita ajustes financeiros.', 409);
}
function normalizeFinancialLineOrThrow(input: Parameters<typeof normalizeEventFinancialLine>[0]) {
  try { return normalizeEventFinancialLine(input); }
  catch (error) { throw new EventsError('LANCAMENTO_INCONSISTENTE', error instanceof Error ? error.message : 'Valores financeiros inconsistentes.', 422); }
}
function normalizeFinancialPaymentOrThrow(input: Parameters<typeof normalizeEventFinancialPayment>[0]) {
  try { return normalizeEventFinancialPayment(input); }
  catch (error) { throw new EventsError('PAGAMENTO_INCONSISTENTE', error instanceof Error ? error.message : 'Pagamento financeiro inconsistente.', 422); }
}
function assertFinancialEntryState(type: string, status: string, actualAmount: number | null) {
  const requiresPayment = type === 'COST' ? status === 'PAID' : ['RECEIVED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(status);
  if (requiresPayment && actualAmount == null) throw new EventsError('STATUS_FINANCEIRO_INCONSISTENTE', 'Um lançamento realizado precisa possuir valor efetivamente recebido ou pago.', 422);
}
async function getTicketSaleDto(tx: Prisma.TransactionClient, contaId: string, saleId: string) {
  const sale = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId }, include: {
    event: { select: { id: true, name: true, startsAt: true } }, lot: { select: { id: true, name: true, ticketType: true } },
    aluno: { select: { id: true, nome: true } }, responsavel: { select: { id: true, nome: true } }, createdBy: { select: { id: true, nome: true } },
  } });
  if (!sale) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  return mapTicketSale(sale);
}
async function getFinancialEntryDto(tx: Prisma.TransactionClient, contaId: string, entryId: string) {
  const entry = await tx.eventFinancialEntry.findFirst({ where: { id: entryId, contaId }, include: {
    event: { select: { id: true, name: true, startsAt: true } }, createdBy: { select: { id: true, nome: true } },
  } });
  if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
  return mapFinancialEntry(entry);
}

export async function quitarEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string, input: QuitarParticipantFeeInput) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);

    if (participant.isFeePaid) {
      throw new EventsError('TAXA_JA_PAGA', 'A taxa de inscrição deste aluno já está paga.', 409);
    }

    const value = participant.registrationFeeCharged.toNumber();
    if (value <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Esta inscrição não possui valor a ser cobrado.', 400);
    }

    let revenueEntryId = participant.revenueEntryId;
    if (revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: revenueEntryId, contaId: ctx.contaId, eventId },
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

    const updatedResult = await tx.eventParticipant.updateMany({
      where: { id: participantId, contaId: ctx.contaId, eventId },
      data: {
        isFeePaid: true,
        feePaymentMethod: input.paymentMethod,
        revenueEntryId,
      },
    });
    if (updatedResult.count !== 1) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    const updated = await tx.eventParticipant.findFirst({ where: { id: participantId, contaId: ctx.contaId, eventId }, select: eventParticipantScalarSelect });

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


export async function markTicketSalePaid(ctx: EventsContext, saleId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventTicketSale.findFirst({
      where: { id: saleId, contaId: ctx.contaId },
      include: {
        event: { select: { name: true, startsAt: true, locationName: true, locationAddress: true } },
        lot: { select: { name: true } },
        aluno: { select: { email: true } },
        responsavel: { select: { email: true } },
        tickets: { where: { status: 'VALID' }, select: { id: true } },
      },
    });
    if (!current) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);

    const transition = validateTicketSaleStatusTransition(current.status, 'PAID');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const now = new Date();
    const accessToken = current.accessToken ?? createPublicToken('sale');
    const buyerEmail =
      normalizeOptionalEmail(current.buyerEmail) ??
      normalizeOptionalEmail(current.responsavel?.email) ??
      normalizeOptionalEmail(current.aluno?.email);
    const updatedResult = await tx.eventTicketSale.updateMany({
      where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
      data: { status: 'PAID', paidAt: now, accessToken },
    });
    if (updatedResult.count !== 1) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    const updated = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId } });

    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, eventId: current.eventId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'RECEIVED', actualAmount: current.totalAmount, realizedAt: now },
    });

    if (buyerEmail && current.tickets.length > 0) {
      await enqueueEventTicketEmail(tx, {
        contaId: ctx.contaId,
        purchaseId: current.id,
        buyerEmail,
        buyerName: current.buyerName,
        eventName: current.event.name,
        eventStartsAt: current.event.startsAt,
        eventLocation: [current.event.locationName, current.event.locationAddress].filter(Boolean).join(' — ') || null,
        ticketType: current.lot.name,
        ticketCount: current.tickets.length,
        ticketsPath: buildPublicEventTicketSalePath(current.id, accessToken),
      });
    }

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
        'ESTORNO_COBRANCA_PENDENTE',
        'Esta venda possui uma cobrança vinculada. Solicite o estorno pela cobrança e aguarde a confirmação.',
        409,
      );
    }

    const transition = validateTicketSaleStatusTransition(current.status, 'REFUNDED');
    if (!transition.ok) throw new EventsError('TRANSICAO_INVALIDA', transition.reason, 409);

    const now = new Date();
    const updatedResult = await tx.eventTicketSale.updateMany({
      where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId },
      data: { status: 'REFUNDED', refundedAt: now, refundedAmount: current.totalAmount, notes: reason ?? current.notes },
    });
    if (updatedResult.count !== 1) throw new EventsError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    const updated = await tx.eventTicketSale.findFirst({ where: { id: saleId, contaId: ctx.contaId, eventId: current.eventId } });
    await tx.eventFinancialEntry.updateMany({
      where: { contaId: ctx.contaId, eventId: current.eventId, originType: 'TICKET_SALE', originId: saleId },
      data: { status: 'REFUNDED', refundedAt: now, actualAmount: current.totalAmount, refundedAmount: current.totalAmount, netAmount: decimal(0) },
    });
    await syncPublicLotQuantity(tx, ctx.contaId, current.lotId);
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


export async function createFinancialEntry(ctx: EventsContext, input: CreateEventFinancialEntryInput) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.schoolEvent.findFirst({ where: { id: input.eventId, contaId: ctx.contaId } });
    if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    assertFinancialAdjustmentEvent(event.status);

    const line = normalizeFinancialLineOrThrow({
      expectedAmount: input.expectedAmount,
      grossAmount: input.grossAmount,
      discountAmount: input.discountAmount,
    });
    const payment = normalizeFinancialPaymentOrThrow({
      actualAmount: input.actualAmount,
      refundedAmount: input.refundedAmount,
      expectedAmount: line.netAmount,
      enforceExpectedLimit: input.type === 'REVENUE',
    });
    if (input.type === 'REVENUE' && payment.actualAmount != null && payment.actualAmount > line.netAmount) {
      throw new EventsError('VALOR_RECEBIDO_INVALIDO', 'O valor recebido não pode ser maior que o valor líquido esperado.', 422);
    }
    assertFinancialEntryState(input.type, input.status, payment.actualAmount);
    const isRealized = input.type === 'COST' ? input.status === 'PAID' : input.status === 'RECEIVED';
    const entry = await tx.eventFinancialEntry.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        type: input.type,
        costClass: input.costClass ?? 'DIRECT',
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        originType: 'MANUAL',
        expectedAmount: decimal(line.netAmount),
        grossAmount: decimal(line.grossAmount),
        discountAmount: decimal(line.discountAmount),
        actualAmount: payment.actualAmount == null ? null : decimal(payment.actualAmount),
        refundedAmount: decimal(payment.refundedAmount),
        netAmount: payment.netAmount == null ? null : decimal(payment.netAmount),
        dueDate: isRealized ? null : input.dueDate,
        realizedAt: isRealized ? (input.realizedAt ?? new Date()) : null,
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

export async function updateFinancialEntry(
  ctx: EventsContext,
  entryId: string,
  input: UpdateEventFinancialEntryInput,
  expectedEventId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventFinancialEntry.findFirst({
      where: {
        id: entryId,
        contaId: ctx.contaId,
        ...(expectedEventId ? { eventId: expectedEventId } : {}),
      },
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

    const line = normalizeFinancialLineOrThrow({
      expectedAmount: input.expectedAmount ?? current.expectedAmount.toNumber(),
      grossAmount: input.grossAmount ?? current.grossAmount?.toNumber(),
      discountAmount: input.discountAmount ?? current.discountAmount.toNumber(),
    });
    const nextActual = input.actualAmount === undefined ? toMoney(current.actualAmount) : input.actualAmount;
    const nextRefunded = input.refundedAmount === undefined ? toMoney(current.refundedAmount) : input.refundedAmount;
    const nextType = input.type ?? current.type;
    const payment = normalizeFinancialPaymentOrThrow({
      actualAmount: nextActual,
      refundedAmount: nextRefunded,
      expectedAmount: line.netAmount,
      enforceExpectedLimit: nextType === 'REVENUE',
    });
    if (nextType === 'REVENUE' && payment.actualAmount != null && payment.actualAmount > line.netAmount) {
      throw new EventsError('VALOR_RECEBIDO_INVALIDO', 'O valor recebido não pode ser maior que o valor líquido esperado.', 422);
    }
    assertFinancialEntryState(nextType, input.status ?? current.status, payment.actualAmount);

    const nextStatus = input.status ?? current.status;
    const isRealized = nextType === 'COST' ? nextStatus === 'PAID' : nextStatus === 'RECEIVED';
    const updatedResult = await tx.eventFinancialEntry.updateMany({
      where: { id: entryId, contaId: ctx.contaId, eventId: current.eventId },
      data: {
        type: input.type,
        costClass: input.costClass,
        category: input.category,
        description: input.description,
        supplier: input.supplier,
        expectedAmount: decimal(line.netAmount),
        grossAmount: decimal(line.grossAmount),
        discountAmount: decimal(line.discountAmount),
        actualAmount: payment.actualAmount == null ? null : decimal(payment.actualAmount),
        refundedAmount: decimal(payment.refundedAmount),
        netAmount: payment.netAmount == null ? null : decimal(payment.netAmount),
        dueDate: isRealized ? null : input.dueDate,
        realizedAt: isRealized ? (input.realizedAt ?? current.realizedAt ?? new Date()) : null,
        status: input.status,
        paymentMethod: input.paymentMethod,
        proofUrl: input.proofUrl,
        notes: input.notes,
      },
    });
    if (updatedResult.count !== 1) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    const updated = await tx.eventFinancialEntry.findFirst({ where: { id: entryId, contaId: ctx.contaId, eventId: current.eventId } });
    if (!updated) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

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
  const updatedEntryResult = await tx.eventFinancialEntry.updateMany({
    where: { id: entryId, contaId: participant.contaId },
    data: {
      actualAmount: totals.received > 0 ? decimal(totals.received) : null,
      refundedAmount: decimal(totals.refunded),
      netAmount: decimal(totals.net),
      status,
      realizedAt: totals.received > 0 ? new Date() : null,
      refundedAt: totals.refunded > 0 ? new Date() : null,
    },
  });
  if (updatedEntryResult.count !== 1) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
  const updatedParticipantResult = await tx.eventParticipant.updateMany({
    where: { id: participant.id, contaId: participant.contaId },
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
  if (updatedParticipantResult.count !== 1) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
  const [entry, updatedParticipant] = await Promise.all([
    tx.eventFinancialEntry.findFirst({ where: { id: entryId, contaId: participant.contaId } }),
    tx.eventParticipant.findFirst({ where: { id: participant.id, contaId: participant.contaId }, select: eventParticipantScalarSelect }),
  ]);
  if (!entry || !updatedParticipant) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
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
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);
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
        throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A inscrição possui uma cobrança vinculada e não pode ser baixada manualmente.', 409);
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
      await tx.eventParticipant.updateMany({
        where: { id: participant.id, eventId, contaId: ctx.contaId },
        data: { revenueEntryId: entryId },
      });
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

    const updatedPaymentResult = await tx.eventFinancialPayment.updateMany({
      where: { id: payment.id, participantId, eventId, contaId: ctx.contaId },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundedAmount: payment.amount, netAmount: decimal(0) },
    });
    if (updatedPaymentResult.count !== 1) throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento manual não encontrado.', 404);
    const updatedPayment = await tx.eventFinancialPayment.findFirst({ where: { id: payment.id, participantId, eventId, contaId: ctx.contaId } });
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
    await tx.eventFinancialPayment.deleteMany({ where: { id: payment.id, participantId, eventId, contaId: ctx.contaId } });
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
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);
    if (!participant.revenueEntryId) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'A inscrição não possui lançamento financeiro vinculado.', 404);
    }

    const entry = await tx.eventFinancialEntry.findFirst({
      where: { id: participant.revenueEntryId, contaId: ctx.contaId },
    });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') {
      throw new EventsError('ESTORNO_ASAAS_BLOQUEADO', 'Use o fluxo de estorno da cobrança para concluir esta operação.', 409);
    }
    if (!['RECEIVED', 'PAID'].includes(entry.status)) {
      throw new EventsError('ESTORNO_BLOQUEADO', 'Somente taxas manuais pagas podem ser estornadas.', 400);
    }

    const refundableAmount = toNumber(entry.actualAmount ?? participant.registrationFeeCharged);
    if (refundableAmount <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Não há valor pago para estornar.', 400);
    }

    const updatedEntryResult = await tx.eventFinancialEntry.updateMany({
      where: { id: entry.id, eventId: participant.eventId, contaId: ctx.contaId },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        refundedAmount: decimal(refundableAmount),
        netAmount: decimal(0),
      },
    });

    const updatedParticipantResult = await tx.eventParticipant.updateMany({
      where: { id: participant.id, eventId, contaId: ctx.contaId },
      data: {
        isFeePaid: false,
        feeRefundedAmount: decimal(refundableAmount),
        feePaidAmount: decimal(0),
        financialStatusSnapshot: 'ESTORNADO',
      },
    });
    if (updatedEntryResult.count !== 1 || updatedParticipantResult.count !== 1) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    }
    const [updatedEntry, updatedParticipant] = await Promise.all([
      tx.eventFinancialEntry.findFirst({ where: { id: entry.id, eventId, contaId: ctx.contaId } }),
      tx.eventParticipant.findFirst({ where: { id: participant.id, eventId, contaId: ctx.contaId }, select: eventParticipantScalarSelect }),
    ]);
    if (!updatedEntry || !updatedParticipant) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

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
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);
    if (!participant.revenueEntryId) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'A inscrição não possui lançamento financeiro vinculado.', 404);
    }

    const entry = await tx.eventFinancialEntry.findFirst({
      where: { id: participant.revenueEntryId, contaId: ctx.contaId },
    });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') {
      throw new EventsError('EXCLUSAO_ASAAS_BLOQUEADA', 'Não é possível excluir uma cobrança vinculada a um pagamento.', 409);
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

    await tx.eventParticipant.updateMany({
      where: { id: participant.id, eventId, contaId: ctx.contaId },
      data: {
        revenueEntryId: null,
        isFeePaid: false,
        financialStatusSnapshot: null,
      },
    });

    await tx.eventFinancialEntry.deleteMany({ where: { id: entry.id, eventId, contaId: ctx.contaId } });

    return { success: true };
  });
}
