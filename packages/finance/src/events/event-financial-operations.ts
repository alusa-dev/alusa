import { Prisma, EventPaymentMethod } from '@prisma/client';
import { prisma } from '@alusa/database';
import { acquireGuardLock } from '../core/idempotency.service';
import {
  EventsError,
  normalizeEventFinancialLine,
  normalizeEventFinancialPayment,
  calculateEventCostPayment,
  supportsEventCostPaymentOrigin,
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
  const legacyMethods: Record<string, EventPaymentMethod> = {
    MANUAL_BOLETO: 'OTHER',
    MANUAL_CARD: 'EXTERNAL_CARD',
    MANUAL_CASH: 'CASH',
    MANUAL_TRANSFER: 'TRANSFER',
  };
  if (legacyMethods[method]) return legacyMethods[method];
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
async function lockEventParticipantForFinancialMutation(tx: Prisma.TransactionClient, contaId: string, eventId: string, participantId: string) {
  const [participant] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT p."id"
    FROM "EventParticipant" p
    WHERE p."id" = ${participantId} AND p."eventId" = ${eventId} AND p."contaId" = ${contaId}
    FOR UPDATE OF p
  `;
  if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
}
async function lockEventFinancialEntryForParticipantMutation(tx: Prisma.TransactionClient, contaId: string, eventId: string, entryId: string) {
  const [entry] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT e."id"
    FROM "EventFinancialEntry" e
    WHERE e."id" = ${entryId} AND e."eventId" = ${eventId} AND e."contaId" = ${contaId}
    FOR UPDATE OF e
  `;
  if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento da inscrição não encontrado.', 404);
}
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
  const requiresPayment = type === 'COST' ? ['PAID', 'PARTIALLY_PAID'].includes(status) : ['RECEIVED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(status);
  if (requiresPayment && (actualAmount == null || actualAmount <= 0)) {
    throw new EventsError('STATUS_FINANCEIRO_INCONSISTENTE', 'Um lançamento realizado precisa possuir valor efetivamente recebido ou pago.', 422);
  }
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
    payments: { where: { contaId }, orderBy: { paidAt: 'asc' } },
  } });
  if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
  return mapFinancialEntry(entry);
}

export async function quitarEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string, input: QuitarParticipantFeeInput) {
  return prisma.$transaction(async (tx) => {
    await acquireGuardLock({ tx, contaId: ctx.contaId, scope: 'event-payment-create', key: input.idempotencyKey });
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);

    const existingPayment = await tx.eventFinancialPayment.findFirst({
      where: { contaId: ctx.contaId, idempotencyKey: input.idempotencyKey },
      select: { id: true, participantId: true, eventId: true, amount: true, paymentMethod: true },
    });
    if (existingPayment) {
      if (existingPayment.participantId !== participant.id || existingPayment.eventId !== eventId
        || existingPayment.paymentMethod !== mapToEventPaymentMethod(input.paymentMethod)) {
        throw new EventsError('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta chave já foi usada em outro pagamento.', 409);
      }
      return tx.eventParticipant.findFirst({
        where: { id: participantId, contaId: ctx.contaId, eventId },
        select: eventParticipantScalarSelect,
      });
    }

    if (participant.isFeePaid) {
      throw new EventsError('TAXA_JA_PAGA', 'A taxa de inscrição deste aluno já está paga.', 409);
    }

    const value = toMoney(participant.registrationFeeCharged);
    if (value <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Esta inscrição não possui valor a ser cobrado.', 400);
    }

    if (participant.billingMode !== 'FULL' || participant.asaasPaymentId || participant.asaasInstallmentId) {
      throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A quitação manual está disponível apenas para inscrições manuais.', 409);
    }

    let revenueEntryId = participant.revenueEntryId;
    if (revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: revenueEntryId, contaId: ctx.contaId, eventId },
        data: {
          originType: 'EVENT_REGISTRATION',
        },
      });
      const scopedEntry = await tx.eventFinancialEntry.findFirst({
        where: { id: revenueEntryId, eventId, contaId: ctx.contaId },
        select: { asaasPaymentId: true, paymentProvider: true },
      });
      if (!scopedEntry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento da inscrição não encontrado.', 404);
      if (scopedEntry.asaasPaymentId || scopedEntry.paymentProvider === 'ASAAS') {
        throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A inscrição possui uma cobrança vinculada e não pode ser baixada manualmente.', 409);
      }
    } else {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: participant.eventId,
          type: 'REVENUE',
          originType: 'EVENT_REGISTRATION',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: decimal(value),
          actualAmount: null,
          dueDate: new Date(),
          status: 'PENDING',
          paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        },
      });
      revenueEntryId = entry.id;
      await tx.eventParticipant.updateMany({
        where: { id: participant.id, eventId, contaId: ctx.contaId },
        data: { revenueEntryId },
      });
    }

    await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, revenueEntryId);

    const totalsBefore = await loadManualPaymentTotals(tx, ctx.contaId, revenueEntryId);
    const remaining = toMoney(Math.max(value - totalsBefore.net, 0));
    if (remaining <= 0) {
      throw new EventsError('TAXA_JA_PAGA', 'A taxa de inscrição deste aluno já está paga.', 409);
    }
    const now = new Date();
    const payment = await tx.eventFinancialPayment.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        financialEntryId: revenueEntryId,
        idempotencyKey: input.idempotencyKey,
        participantId: participant.id,
        amount: decimal(remaining),
        paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        paidAt: now,
        notes: null,
        status: 'RECEIVED',
        refundedAmount: decimal(0),
        netAmount: decimal(remaining),
        createdByUserId: ctx.userId,
      },
    });
    const refreshed = await refreshManualParticipantPaymentSnapshot(tx, { ...participant, contaId: ctx.contaId }, revenueEntryId);
    const updated = refreshed.participant;

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.quitar',
      entityType: 'EventParticipant',
      entityId: participantId,
      eventId: participant.eventId,
      before: participant,
      after: { payment, participant: updated, totals: refreshed.totals },
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
    if (input.type === 'COST' && payment.actualAmount != null && payment.actualAmount > line.netAmount) {
      throw new EventsError('VALOR_PAGO_INVALIDO', 'O valor pago não pode ser maior que o valor esperado.', 422);
    }
    const isCostPaymentStatus = input.type === 'COST' && ['PAID', 'PARTIALLY_PAID'].includes(input.status);
    const entryStatus = isCostPaymentStatus && payment.actualAmount != null
      ? payment.actualAmount >= line.netAmount ? 'PAID' : 'PARTIALLY_PAID'
      : input.status;
    assertFinancialEntryState(input.type, entryStatus, payment.actualAmount);
    const isRealized = input.type === 'COST' ? entryStatus === 'PAID' : entryStatus === 'RECEIVED';
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
        realizedAt: input.type === 'COST' && entryStatus === 'PARTIALLY_PAID'
          ? (input.realizedAt ?? new Date())
          : isRealized ? (input.realizedAt ?? new Date()) : null,
        status: entryStatus,
        paymentMethod: input.paymentMethod,
        proofUrl: input.proofUrl,
        notes: input.notes,
        createdByUserId: ctx.userId,
      },
    });

    if (input.type === 'COST' && isCostPaymentStatus && payment.actualAmount != null && payment.actualAmount > 0) {
      await tx.eventFinancialPayment.create({ data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        financialEntryId: entry.id,
        amount: decimal(payment.actualAmount),
        paymentMethod: mapToEventPaymentMethod(input.paymentMethod),
        paidAt: input.realizedAt ?? new Date(),
        notes: input.notes,
        status: 'PAID',
        refundedAmount: decimal(0),
        netAmount: decimal(payment.actualAmount),
        createdByUserId: ctx.userId,
      } });
    }

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
    // Serialize edits with payment registration on the same tenant-owned row.
    // Read the entry and payment ledger only after acquiring this lock so an
    // edit cannot validate against a stale paid total while a payment commits.
    const [lockedEntry] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e."id"
      FROM "EventFinancialEntry" e
      WHERE e."id" = ${entryId} AND e."contaId" = ${ctx.contaId}
      FOR UPDATE OF e
    `;
    if (!lockedEntry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

    const current = await tx.eventFinancialEntry.findFirst({
      where: {
        id: entryId,
        contaId: ctx.contaId,
        ...(expectedEventId ? { eventId: expectedEventId } : {}),
      },
      include: { event: true },
    });
    if (!current) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    const sourceManagedCostRefund = current.type === 'COST'
      && supportsEventCostPaymentOrigin(current.originType, current.originId)
      && input.status === 'REFUNDED'
      && Object.entries(input).every(([key, value]) => value === undefined || ['status', 'actualAmount', 'realizedAt', 'refundedAmount'].includes(key));
    if (current.originType !== 'MANUAL' && !sourceManagedCostRefund) {
      throw new EventsError(
        'LANCAMENTO_AUTOMATICO',
        'Lançamentos automáticos devem ser alterados pela origem. Pagamentos registrados podem ser estornados pelo histórico.',
        409,
      );
    }
    assertFinancialAdjustmentEvent(current.event.status);

    const line = normalizeFinancialLineOrThrow({
      expectedAmount: input.expectedAmount ?? current.expectedAmount.toNumber(),
      grossAmount: input.grossAmount ?? current.grossAmount?.toNumber(),
      discountAmount: input.discountAmount ?? current.discountAmount.toNumber(),
    });
    const costPaymentTotals = current.type === 'COST'
      ? await loadManualPaymentTotals(tx, ctx.contaId, entryId)
      : null;
    const hasCostPaymentHistory = current.type === 'COST' && Boolean(costPaymentTotals && costPaymentTotals.received > 0);
    if (sourceManagedCostRefund && !hasCostPaymentHistory) {
      throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Não há pagamento registrado para estornar neste custo.', 409);
    }
    if (hasCostPaymentHistory && costPaymentTotals) {
      if (input.type && input.type !== 'COST') {
        throw new EventsError('LANCAMENTO_COM_PAGAMENTOS', 'Não é possível alterar o tipo de um custo com pagamentos registrados.', 409);
      }
      if (line.netAmount < costPaymentTotals.net) {
        throw new EventsError('VALOR_ABAIXO_DO_PAGO', 'O valor esperado não pode ser menor que o total já pago.', 422);
      }
      if (input.actualAmount !== undefined && toMoney(input.actualAmount) !== costPaymentTotals.received) {
        throw new EventsError('PAGAMENTO_IMUTAVEL', 'Altere os valores pagos registrando pagamentos ou estornos no histórico.', 409);
      }
      if (input.status === 'CANCELLED') {
        throw new EventsError('CUSTO_COM_PAGAMENTO_NAO_PODE_SER_CANCELADO', 'Estorne os pagamentos registrados antes de encerrar este custo.', 409);
      }
      if (input.status === 'REFUNDED' && costPaymentTotals.net <= 0) {
        throw new EventsError('PAGAMENTO_JA_ESTORNADO', 'Não há saldo pago para estornar neste custo.', 409);
      }
    }
    const nextActual = hasCostPaymentHistory && costPaymentTotals
      ? costPaymentTotals.received
      : input.actualAmount === undefined ? toMoney(current.actualAmount) : input.actualAmount;
    const nextRefunded = input.status === 'REFUNDED' && hasCostPaymentHistory && costPaymentTotals
      ? costPaymentTotals.received
      : hasCostPaymentHistory && costPaymentTotals
        ? costPaymentTotals.refunded
        : input.refundedAmount === undefined ? toMoney(current.refundedAmount) : input.refundedAmount;
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
    if (current.type === 'COST' && !hasCostPaymentHistory && ['PAID', 'PARTIALLY_PAID'].includes(input.status ?? current.status)) {
      throw new EventsError('PAGAMENTO_DEVE_SER_REGISTRADO', 'Registre pagamentos pelo histórico para manter o saldo e a auditoria consistentes.', 409);
    }
    const nextStatus = hasCostPaymentHistory && costPaymentTotals
      ? input.status === 'REFUNDED'
        ? 'REFUNDED'
        : costPaymentTotals.net <= 0 && costPaymentTotals.refunded > 0
          ? 'REFUNDED'
          : costPaymentTotals.net >= line.netAmount && line.netAmount > 0
            ? 'PAID'
            : costPaymentTotals.net > 0 ? 'PARTIALLY_PAID' : (input.status ?? current.status)
      : input.status ?? current.status;
    assertFinancialEntryState(nextType, nextStatus, payment.actualAmount);
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
        dueDate: isRealized ? null : input.dueDate ?? current.dueDate,
        realizedAt: nextType === 'COST' && nextStatus === 'PARTIALLY_PAID'
          ? (input.realizedAt ?? current.realizedAt ?? new Date())
          : isRealized ? (input.realizedAt ?? current.realizedAt ?? new Date()) : null,
        cancelledAt: nextStatus === 'CANCELLED' ? (current.cancelledAt ?? new Date()) : null,
        refundedAt: ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(nextStatus) ? (current.refundedAt ?? new Date()) : null,
        status: nextStatus,
        paymentMethod: input.paymentMethod,
        proofUrl: input.proofUrl,
        notes: input.notes,
      },
    });
    if (updatedResult.count !== 1) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (nextType === 'COST' && nextStatus === 'REFUNDED' && hasCostPaymentHistory) {
      const payments = await tx.eventFinancialPayment.findMany({
        where: { contaId: ctx.contaId, financialEntryId: entryId },
        select: { id: true, amount: true },
      });
      const refundedAt = new Date();
      for (const costPayment of payments) {
        await tx.eventFinancialPayment.updateMany({
          where: { id: costPayment.id, contaId: ctx.contaId, financialEntryId: entryId },
          data: { status: 'REFUNDED', refundedAt, refundedAmount: costPayment.amount, netAmount: decimal(0) },
        });
      }
    }
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

export async function registerEventCostPayment(
  ctx: EventsContext,
  entryId: string,
  input: { idempotencyKey: string; amount: number; paymentMethod: EventPaymentMethod; paidAt?: Date | null; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    await acquireGuardLock({ tx, contaId: ctx.contaId, scope: 'event-payment-create', key: input.idempotencyKey });
    // Lock the tenant-owned row so concurrent submissions compute the balance
    // serially. The lock and ledger/summary writes share this transaction.
    const [entry] = await tx.$queryRaw<Array<{ id: string; contaId: string; eventId: string; type: string; originType: string; originId: string | null; status: string; expectedAmount: Prisma.Decimal; actualAmount: Prisma.Decimal | null; dueDate: Date | null; eventStatus: string }>>`
      SELECT e."id", e."contaId", e."eventId", e."type"::text AS "type", e."originType"::text AS "originType", e."originId",
             e."status"::text AS "status", e."expectedAmount", e."actualAmount", e."dueDate", ev."status"::text AS "eventStatus"
      FROM "EventFinancialEntry" e JOIN "SchoolEvent" ev ON ev."id" = e."eventId" AND ev."contaId" = e."contaId"
      WHERE e."id" = ${entryId} AND e."contaId" = ${ctx.contaId}
      FOR UPDATE OF e
    `;
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    const existingPayment = await tx.eventFinancialPayment.findFirst({
      where: { contaId: ctx.contaId, idempotencyKey: input.idempotencyKey },
      select: { id: true, financialEntryId: true, amount: true, paymentMethod: true, paidAt: true, notes: true },
    });
    if (existingPayment) {
      if (existingPayment.financialEntryId !== entry.id
        || toMoney(existingPayment.amount) !== toMoney(input.amount)
        || existingPayment.paymentMethod !== input.paymentMethod
        || (existingPayment.notes ?? null) !== (input.notes ?? null)
        || (input.paidAt != null && existingPayment.paidAt.getTime() !== input.paidAt.getTime())) {
        throw new EventsError('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta chave já foi usada em outro lançamento.', 409);
      }
      return getFinancialEntryDto(tx, ctx.contaId, entry.id);
    }
    if (entry.type !== 'COST' || !supportsEventCostPaymentOrigin(entry.originType, entry.originId)) {
      throw new EventsError('BAIXA_NAO_DISPONIVEL', 'Este lançamento não aceita pagamentos registrados por esta tela.', 409);
    }
    assertFinancialAdjustmentEvent(entry.eventStatus);
    if (['CANCELLED', 'REFUNDED', 'PAID'].includes(entry.status)) throw new EventsError('LANCAMENTO_ENCERRADO', 'Este custo não aceita novos pagamentos.', 409);
    let calculation: ReturnType<typeof calculateEventCostPayment>;
    try {
      calculation = calculateEventCostPayment({ expectedAmount: entry.expectedAmount.toString(), paidAmount: entry.actualAmount?.toString(), paymentAmount: input.amount });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pagamento inválido.';
      throw new EventsError(message.includes('saldo') ? 'VALOR_ACIMA_DO_SALDO' : 'VALOR_INVALIDO', message, 422);
    }
    const amount = toMoney(input.amount);
    const totalPaid = calculation.totalPaid;
    const nextStatus = calculation.status;
    const now = input.paidAt ?? new Date();
    const payment = await tx.eventFinancialPayment.create({ data: {
      contaId: ctx.contaId, eventId: entry.eventId, financialEntryId: entry.id,
      idempotencyKey: input.idempotencyKey,
      amount: decimal(amount), paymentMethod: input.paymentMethod, paidAt: now, notes: input.notes,
      status: 'PAID', refundedAmount: decimal(0), netAmount: decimal(amount), createdByUserId: ctx.userId,
    } });
    const updatedResult = await tx.eventFinancialEntry.updateMany({
      where: { id: entry.id, contaId: ctx.contaId, eventId: entry.eventId },
      data: {
        actualAmount: decimal(totalPaid), status: nextStatus, realizedAt: now,
        paymentMethod: input.paymentMethod, dueDate: nextStatus === 'PAID' ? null : entry.dueDate,
      },
    });
    if (updatedResult.count !== 1) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    const updated = await tx.eventFinancialEntry.findFirst({ where: { id: entry.id, contaId: ctx.contaId } });
    await recordEventAudit(tx, {
      contaId: ctx.contaId, actorUserId: ctx.userId, action: 'events.finance.cost.payment.create',
      entityType: 'EventFinancialPayment', entityId: payment.id, eventId: entry.eventId,
      before: { entry, balance: calculation.balance }, after: { payment, entry: updated, balance: calculation.remaining },
    });
    return getFinancialEntryDto(tx, ctx.contaId, entry.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function registerCostumeAssignmentPayment(
  ctx: EventsContext,
  entryId: string,
  input: { idempotencyKey: string; amount: number; paymentMethod: EventPaymentMethod; paidAt?: Date | null; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    await acquireGuardLock({ tx, contaId: ctx.contaId, scope: 'event-payment-create', key: input.idempotencyKey });
    const assignmentCandidate = await tx.eventCostumeAssignment.findFirst({ where: { contaId: ctx.contaId, revenueEntryId: entryId }, select: { id: true } });
    if (!assignmentCandidate) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino associado à receita não encontrado.', 404);
    await tx.$queryRaw`SELECT "id" FROM "EventCostumeAssignment" WHERE "id" = ${assignmentCandidate.id} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
    const assignmentState = await tx.eventCostumeAssignment.findFirst({ where: { id: assignmentCandidate.id, contaId: ctx.contaId }, select: { status: true, revenueEntryId: true } });
    if (!assignmentState || assignmentState.revenueEntryId !== entryId) {
      throw new EventsError('VINCULO_CANCELADO', 'Vínculos cancelados não aceitam novos recebimentos.', 409);
    }
    const [entry] = await tx.$queryRaw<Array<{ id: string; eventId: string; status: string; expectedAmount: Prisma.Decimal; actualAmount: Prisma.Decimal | null; eventStatus: string; asaasPaymentId: string | null; paymentProvider: string | null }>>`
      SELECT e."id", e."eventId", e."status"::text AS "status", e."expectedAmount", e."actualAmount", e."asaasPaymentId", e."paymentProvider", ev."status"::text AS "eventStatus"
      FROM "EventFinancialEntry" e JOIN "SchoolEvent" ev ON ev."id" = e."eventId" AND ev."contaId" = e."contaId"
      WHERE e."id" = ${entryId} AND e."contaId" = ${ctx.contaId} AND e."type" = 'REVENUE' AND e."originType" = 'COSTUME_ASSIGNMENT'
      FOR UPDATE OF e
    `;
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Receita de figurino não encontrada.', 404);
    const existingPayment = await tx.eventFinancialPayment.findFirst({
      where: { contaId: ctx.contaId, idempotencyKey: input.idempotencyKey },
      select: { id: true, financialEntryId: true, amount: true, paymentMethod: true, notes: true, paidAt: true },
    });
    if (existingPayment) {
      if (existingPayment.financialEntryId !== entry.id || toMoney(existingPayment.amount) !== toMoney(input.amount)
        || existingPayment.paymentMethod !== input.paymentMethod || (existingPayment.notes ?? null) !== (input.notes ?? null)
        || (input.paidAt != null && existingPayment.paidAt.getTime() !== input.paidAt.getTime())) {
        throw new EventsError('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta chave já foi usada em outro lançamento.', 409);
      }
      return getFinancialEntryDto(tx, ctx.contaId, entry.id);
    }
    if (assignmentState.status === 'CANCELLED') throw new EventsError('VINCULO_CANCELADO', 'Vínculos cancelados não aceitam novos recebimentos.', 409);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'Esta receita possui cobrança Asaas vinculada.', 409);
    assertFinancialAdjustmentEvent(entry.eventStatus);
    if (['CANCELLED', 'REFUNDED', 'PAID'].includes(entry.status)) throw new EventsError('LANCAMENTO_ENCERRADO', 'Esta receita não aceita novos recebimentos.', 409);
    const amount = toMoney(input.amount);
    const expected = toMoney(entry.expectedAmount);
    const totalsBefore = await loadManualPaymentTotals(tx, ctx.contaId, entry.id);
    const paid = totalsBefore.net;
    if (amount <= 0) throw new EventsError('VALOR_INVALIDO', 'Informe um valor maior que zero.', 422);
    const remaining = toMoney(Math.max(expected - paid, 0));
    if (amount > remaining) throw new EventsError('VALOR_ACIMA_DO_SALDO', `O valor máximo para recebimento é ${remaining.toFixed(2)}.`, 422);
    const totalPaid = toMoney(paid + amount);
    const totalReceived = toMoney(totalsBefore.received + amount);
    const nextStatus = totalPaid >= expected
      ? 'RECEIVED'
      : totalsBefore.refunded > 0 ? 'PARTIALLY_REFUNDED' : 'PARTIALLY_PAID';
    const now = input.paidAt ?? new Date();
    const payment = await tx.eventFinancialPayment.create({ data: {
      contaId: ctx.contaId, eventId: entry.eventId, financialEntryId: entry.id,
      idempotencyKey: input.idempotencyKey, amount: decimal(amount), paymentMethod: input.paymentMethod,
      paidAt: now, notes: input.notes, status: 'PAID', refundedAmount: decimal(0), netAmount: decimal(amount), createdByUserId: ctx.userId,
    } });
    await tx.eventFinancialEntry.updateMany({
      where: { id: entry.id, contaId: ctx.contaId, eventId: entry.eventId },
      data: { actualAmount: decimal(totalReceived), refundedAmount: decimal(totalsBefore.refunded), netAmount: decimal(totalPaid), status: nextStatus, realizedAt: now, paymentMethod: input.paymentMethod },
    });
    const assignment = await tx.eventCostumeAssignment.findFirst({ where: { contaId: ctx.contaId, revenueEntryId: entry.id }, select: { id: true } });
    if (!assignment) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino associado à receita não encontrado.', 409);
    await tx.eventCostumeAssignment.updateMany({ where: { id: assignment.id, contaId: ctx.contaId }, data: { isPaid: nextStatus === 'RECEIVED' } });
    await recordEventAudit(tx, {
      contaId: ctx.contaId, actorUserId: ctx.userId, action: 'events.costumeAssignment.payment.create',
      entityType: 'EventFinancialPayment', entityId: payment.id, eventId: entry.eventId,
      before: { entry, paidAmount: paid, remaining }, after: { payment, paidAmount: totalPaid, remaining: toMoney(expected - totalPaid) },
    });
    return getFinancialEntryDto(tx, ctx.contaId, entry.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function refundCostumeAssignmentPayment(
  ctx: EventsContext,
  entryId: string,
  input: { idempotencyKey: string; amount?: number | null },
) {
  return prisma.$transaction(async (tx) => {
    await acquireGuardLock({ tx, contaId: ctx.contaId, scope: 'event-payment-refund', key: input.idempotencyKey });
    const priorAudit = await tx.eventAudit.findFirst({
      where: { contaId: ctx.contaId, action: 'events.costumeAssignment.payment.refund', metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } },
      select: { entityId: true, metadata: true },
    });
    if (priorAudit) {
      const metadata = priorAudit.metadata && typeof priorAudit.metadata === 'object' && !Array.isArray(priorAudit.metadata)
        ? priorAudit.metadata as Record<string, unknown>
        : {};
      const priorRequestedAmount = metadata.requestedAmount == null ? null : Number(metadata.requestedAmount);
      const requestedAmount = input.amount == null ? null : toMoney(input.amount);
      if (priorAudit.entityId !== entryId || priorRequestedAmount !== requestedAmount) {
        throw new EventsError('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta chave já foi usada em outro estorno.', 409);
      }
      return getFinancialEntryDto(tx, ctx.contaId, entryId);
    }
    const assignmentCandidate = await tx.eventCostumeAssignment.findFirst({ where: { contaId: ctx.contaId, revenueEntryId: entryId }, select: { id: true } });
    if (!assignmentCandidate) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino associado à receita não encontrado.', 404);
    await tx.$queryRaw`SELECT "id" FROM "EventCostumeAssignment" WHERE "id" = ${assignmentCandidate.id} AND "contaId" = ${ctx.contaId} FOR UPDATE`;
    const assignmentState = await tx.eventCostumeAssignment.findFirst({ where: { id: assignmentCandidate.id, contaId: ctx.contaId }, select: { status: true, revenueEntryId: true } });
    if (!assignmentState || assignmentState.revenueEntryId !== entryId) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino associado à receita não encontrado.', 404);
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e."id" FROM "EventFinancialEntry" e
      WHERE e."id" = ${entryId} AND e."contaId" = ${ctx.contaId} AND e."type" = 'REVENUE' AND e."originType" = 'COSTUME_ASSIGNMENT'
      FOR UPDATE OF e
    `;
    if (!locked) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Receita de figurino não encontrada.', 404);
    const entry = await tx.eventFinancialEntry.findFirst({ where: { id: entryId, contaId: ctx.contaId }, include: { event: true } });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Receita de figurino não encontrada.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') throw new EventsError('ESTORNO_ASAAS_BLOQUEADO', 'O estorno desta cobrança vinculada ao Asaas deve ser processado pela cobrança e confirmado pelo webhook.', 409);
    assertFinancialAdjustmentEvent(entry.event.status);
    const payments = await tx.eventFinancialPayment.findMany({ where: { contaId: ctx.contaId, financialEntryId: entryId, status: { in: ['PAID', 'REFUNDED'] } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] });
    const remainingTotal = toMoney(payments.reduce((sum, payment) => sum + Math.max(toMoney(payment.amount) - toMoney(payment.refundedAmount), 0), 0));
    const refundAmount = input.amount == null ? remainingTotal : toMoney(input.amount);
    if (refundAmount <= 0 || refundAmount > remainingTotal) throw new EventsError('VALOR_ESTORNO_INVALIDO', `O estorno deve ser maior que zero e não superar ${remainingTotal.toFixed(2)}.`, 422);
    let toRefund = refundAmount;
    for (const payment of payments) {
      if (toRefund <= 0) break;
      const paymentRemaining = toMoney(Math.max(toMoney(payment.amount) - toMoney(payment.refundedAmount), 0));
      if (paymentRemaining <= 0) continue;
      const amount = Math.min(paymentRemaining, toRefund);
      const refundedAmount = toMoney(toMoney(payment.refundedAmount) + amount);
      const fullyRefunded = refundedAmount >= toMoney(payment.amount);
      await tx.eventFinancialPayment.updateMany({ where: { id: payment.id, contaId: ctx.contaId }, data: {
        refundedAmount: decimal(refundedAmount), netAmount: decimal(toMoney(toMoney(payment.amount) - refundedAmount)),
        status: fullyRefunded ? 'REFUNDED' : 'PAID', refundedAt: fullyRefunded ? new Date() : null,
      } });
      toRefund = toMoney(toRefund - amount);
    }
    const updatedPayments = await tx.eventFinancialPayment.findMany({ where: { contaId: ctx.contaId, financialEntryId: entryId } });
    const totalReceived = toMoney(updatedPayments.reduce((sum, payment) => sum + toMoney(payment.amount), 0));
    const totalRefunded = toMoney(updatedPayments.reduce((sum, payment) => sum + toMoney(payment.refundedAmount), 0));
    const netPaid = toMoney(totalReceived - totalRefunded);
    const nextStatus = netPaid <= 0
      ? 'REFUNDED'
      : totalRefunded > 0 ? 'PARTIALLY_REFUNDED'
        : netPaid >= toMoney(entry.expectedAmount) ? 'RECEIVED' : 'PARTIALLY_PAID';
    await tx.eventFinancialEntry.updateMany({ where: { id: entryId, contaId: ctx.contaId }, data: {
      actualAmount: decimal(totalReceived), refundedAmount: decimal(totalRefunded), netAmount: decimal(netPaid), status: nextStatus,
    } });
    const assignment = await tx.eventCostumeAssignment.findFirst({ where: { contaId: ctx.contaId, revenueEntryId: entryId }, select: { id: true } });
    if (!assignment) throw new EventsError('VINCULO_NAO_ENCONTRADO', 'Vínculo de figurino associado à receita não encontrado.', 409);
    await tx.eventCostumeAssignment.updateMany({ where: { id: assignment.id, contaId: ctx.contaId }, data: { isPaid: netPaid >= toMoney(entry.expectedAmount) } });
    await recordEventAudit(tx, {
      contaId: ctx.contaId, actorUserId: ctx.userId, action: 'events.costumeAssignment.payment.refund',
      entityType: 'EventFinancialEntry', entityId: entryId, eventId: entry.eventId,
      before: { entry, payments }, after: { totalReceived, totalRefunded, netPaid, status: nextStatus },
      metadata: { idempotencyKey: input.idempotencyKey, amount: refundAmount, requestedAmount: input.amount == null ? null : toMoney(input.amount) },
    });
    return getFinancialEntryDto(tx, ctx.contaId, entryId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteEventCost(ctx: EventsContext, entryId: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.eventFinancialEntry.findFirst({
      where: { id: entryId, contaId: ctx.contaId, type: 'COST' },
      select: { originType: true, originId: true },
    });
    if (!source) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

    // Costume loss entries can be materialized again by assignment updates.
    // Serialize deletion with that source writer before taking the entry lock.
    if (source.originType === 'COSTUME' && source.originId?.startsWith('loss:')) {
      const key = `event-cost-origin:${ctx.contaId}:${source.originType}:${source.originId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    // Keep this lock identical to registerEventCostPayment: either payment
    // creation commits first and is observed below, or deletion wins first.
    const [entry] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e."id"
      FROM "EventFinancialEntry" e
      WHERE e."id" = ${entryId} AND e."contaId" = ${ctx.contaId}
      FOR UPDATE OF e
    `;
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

    const current = await tx.eventFinancialEntry.findFirst({
      where: { id: entryId, contaId: ctx.contaId, type: 'COST' },
      include: { payments: { where: { contaId: ctx.contaId }, orderBy: { paidAt: 'asc' } } },
    });
    if (!current) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);

    if (current.payments.length > 0 || toMoney(current.actualAmount) > 0
      || Boolean(current.asaasPaymentId || current.paymentProvider || current.paymentStatus)
      || ['PAID', 'PARTIALLY_PAID', 'RECEIVED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(current.status)) {
      throw new EventsError('EXCLUSAO_BLOQUEADA_PAGO', 'Não é possível excluir um custo com histórico de pagamento ou recebimento. Preserve o ledger financeiro.', 409);
    }

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.finance.cost.delete',
      entityType: 'EventFinancialEntry',
      entityId: current.id,
      eventId: current.eventId,
      before: {
        entry: current,
        payments: current.payments,
        asaasReference: {
          paymentProvider: current.paymentProvider,
          asaasPaymentId: current.asaasPaymentId,
          paymentStatus: current.paymentStatus,
        },
      },
      after: null,
      metadata: {
        deletion: 'hard',
        originType: current.originType,
        originId: current.originId,
        paymentProvider: current.paymentProvider,
        asaasPaymentId: current.asaasPaymentId,
        paymentStatus: current.paymentStatus,
      },
    });
    const deleted = await tx.eventFinancialEntry.deleteMany({ where: { id: entryId, contaId: ctx.contaId } });
    if (deleted.count !== 1) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    return { success: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
      : totals.net > 0
        ? 'PARTIALLY_PAID'
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
    await acquireGuardLock({ tx, contaId: ctx.contaId, scope: 'event-payment-create', key: input.idempotencyKey });
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);

    const existingPayment = await tx.eventFinancialPayment.findFirst({
      where: { contaId: ctx.contaId, idempotencyKey: input.idempotencyKey },
      select: { id: true, eventId: true, participantId: true, amount: true, paymentMethod: true, financialEntryId: true, notes: true, paidAt: true },
    });
    if (existingPayment) {
      if (existingPayment.participantId !== participant.id || existingPayment.eventId !== eventId
        || toMoney(existingPayment.amount) !== toMoney(input.amount)
        || existingPayment.paymentMethod !== mapToEventPaymentMethod(input.paymentMethod)
        || (existingPayment.notes ?? null) !== (input.notes ?? null)
        || (input.paidAt != null && existingPayment.paidAt.getTime() !== input.paidAt.getTime())) {
        throw new EventsError('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta chave já foi usada em outro pagamento.', 409);
      }
      return { payment: existingPayment, ...await refreshManualParticipantPaymentSnapshot(tx, { ...participant, contaId: ctx.contaId }, existingPayment.financialEntryId) };
    }
    if (participant.billingMode !== 'FULL' || participant.asaasPaymentId || participant.asaasInstallmentId) {
      throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A baixa manual está disponível apenas para inscrições manuais.', 409);
    }

    const amount = toMoney(input.amount);
    const expected = toMoney(participant.registrationFeeCharged);
    if (amount <= 0) throw new EventsError('VALOR_INVALIDO', 'Informe um valor maior que zero.', 422);

    let entryId = participant.revenueEntryId;
    if (entryId) {
      let entry = await tx.eventFinancialEntry.findFirst({ where: { id: entryId, eventId, contaId: ctx.contaId } });
      if (!entry) entryId = null;
      if (entry) {
        await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, entry.id);
        entry = await tx.eventFinancialEntry.findFirst({ where: { id: entry.id, eventId, contaId: ctx.contaId } });
      }
      if (entry?.asaasPaymentId || entry?.paymentProvider === 'ASAAS') {
        throw new EventsError('BAIXA_MANUAL_BLOQUEADA', 'A inscrição possui uma cobrança vinculada e não pode ser baixada manualmente.', 409);
      }
      if (entry) {
        await tx.eventFinancialEntry.updateMany({
          where: { id: entry.id, contaId: ctx.contaId, eventId },
          data: { originType: 'EVENT_REGISTRATION' },
        });
      }
    }
    if (!entryId) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          type: 'REVENUE',
          originType: 'EVENT_REGISTRATION',
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

    await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, entryId);

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
        idempotencyKey: input.idempotencyKey,
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
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
    const payment = await tx.eventFinancialPayment.findFirst({
      where: { id: paymentId, participantId, eventId, contaId: ctx.contaId },
      include: { participant: true },
    });
    if (!payment?.participant) throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento manual não encontrado.', 404);
    await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, payment.financialEntryId);
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
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
    const payment = await tx.eventFinancialPayment.findFirst({
      where: { id: paymentId, participantId, eventId, contaId: ctx.contaId },
      include: { participant: true },
    });
    if (!payment?.participant) throw new EventsError('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento manual não encontrado.', 404);
    await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, payment.financialEntryId);
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
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
    const participant = await tx.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      select: { ...eventParticipantScalarSelect, event: true },
    });
    if (!participant) throw new EventsError('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada.', 404);
    assertFinancialAdjustmentEvent(participant.event.status);
    if (!participant.revenueEntryId) {
      throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'A inscrição não possui lançamento financeiro vinculado.', 404);
    }

    let entry = await tx.eventFinancialEntry.findFirst({
      where: { id: participant.revenueEntryId, contaId: ctx.contaId },
    });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    await lockEventFinancialEntryForParticipantMutation(tx, ctx.contaId, eventId, entry.id);
    entry = await tx.eventFinancialEntry.findFirst({ where: { id: entry.id, eventId, contaId: ctx.contaId } });
    if (!entry) throw new EventsError('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado.', 404);
    if (entry.asaasPaymentId || entry.paymentProvider === 'ASAAS') {
      throw new EventsError('ESTORNO_ASAAS_BLOQUEADO', 'Use o fluxo de estorno da cobrança para concluir esta operação.', 409);
    }
    if (!['RECEIVED', 'PAID', 'PARTIALLY_REFUNDED'].includes(entry.status)) {
      throw new EventsError('ESTORNO_BLOQUEADO', 'Somente taxas manuais pagas podem ser estornadas.', 400);
    }

    let payments = await tx.eventFinancialPayment.findMany({
      where: { contaId: ctx.contaId, eventId, participantId, financialEntryId: entry.id },
      orderBy: { paidAt: 'asc' },
    });
    if (payments.length === 0) {
      const historicalAmount = toMoney(entry.actualAmount ?? participant.registrationFeeCharged);
      if (historicalAmount <= 0) {
        throw new EventsError('VALOR_INVALIDO', 'Não há valor pago para estornar.', 400);
      }
      // Older manual registrations predate the payment ledger. Materialize the
      // known receipt before refunding so the resulting history remains auditable.
      const legacyPayment = await tx.eventFinancialPayment.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          financialEntryId: entry.id,
          participantId: participant.id,
          amount: decimal(historicalAmount),
          paymentMethod: entry.paymentMethod ?? mapToEventPaymentMethod(participant.feePaymentMethod),
          paidAt: entry.realizedAt ?? participant.createdAt,
          notes: 'Registro histórico convertido para preservar o histórico de estorno.',
          status: 'RECEIVED',
          refundedAmount: decimal(0),
          netAmount: decimal(historicalAmount),
          createdByUserId: ctx.userId,
        },
      });
      payments = [legacyPayment];
    }

    const refundableAmount = toMoney(payments.reduce((sum, payment) => sum + Math.max(toMoney(payment.amount) - toMoney(payment.refundedAmount), 0), 0));
    if (refundableAmount <= 0) {
      throw new EventsError('VALOR_INVALIDO', 'Não há valor pago para estornar.', 400);
    }

    const refundedAt = new Date();
    for (const payment of payments) {
      const amount = toMoney(payment.amount);
      const alreadyRefunded = toMoney(payment.refundedAmount);
      if (alreadyRefunded >= amount) continue;
      await tx.eventFinancialPayment.updateMany({
        where: { id: payment.id, contaId: ctx.contaId, eventId, participantId, financialEntryId: entry.id },
        data: {
          status: 'REFUNDED',
          refundedAt,
          refundedAmount: decimal(amount),
          netAmount: decimal(0),
        },
      });
    }
    const refreshed = await refreshManualParticipantPaymentSnapshot(tx, { ...participant, contaId: ctx.contaId }, entry.id);

    await recordEventAudit(tx, {
      contaId: ctx.contaId,
      actorUserId: ctx.userId,
      action: 'events.participant.fee.refund',
      entityType: 'EventFinancialEntry',
      entityId: entry.id,
      eventId: participant.eventId,
      before: { participant, entry },
      after: { participant: refreshed.participant, entry: refreshed.entry, totalRefunded: refreshed.totals.refunded },
    });

    return { success: true };
  });
}

export async function deleteManualEventParticipantFee(ctx: EventsContext, eventId: string, participantId: string) {
  return prisma.$transaction(async (tx) => {
    await lockEventParticipantForFinancialMutation(tx, ctx.contaId, eventId, participantId);
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
    const paymentHistoryCount = await tx.eventFinancialPayment.count({
      where: { contaId: ctx.contaId, eventId, participantId, financialEntryId: entry.id },
    });
    if (paymentHistoryCount > 0 || participant.isFeePaid || entry.actualAmount || ['RECEIVED', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(entry.status)) {
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
