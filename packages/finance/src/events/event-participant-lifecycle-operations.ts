import { Prisma, type EventPaymentMethod } from '@prisma/client';
import { prisma } from '@alusa/database';
import { EventsError } from '@alusa/domain/events';
import {
  eventParticipantScalarSelect,
  calculateParticipantPayment,
  allocateChargesToParticipant,
  loadEventBillingGroupCharges,
  type EventsContext,
} from '@alusa/lib/events/events.service';
import { recordEventAudit } from '@alusa/lib/events/event-audit.service';
import { buildEventParticipantRemovalDecision } from '@alusa/lib/events/event-participant-removal-decision.service';
import { createEventContractForParticipant } from '@alusa/lib/events/event-contracts.service';
import { eventPaymentRulesFromRecord } from '@alusa/lib/events/events-payment-rules';
import {
  convergeStandaloneInstallmentPlanStatus,
  listStandaloneInstallmentPlanIdsForParticipant,
} from '@alusa/lib/services/standalone-installment-plan-status.service';
import type { ReactivateEventParticipantInput } from '@alusa/lib/events/events.schema';

function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  const parsed = value == null ? 0 : value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function mapToEventPaymentMethod(method?: string | null): EventPaymentMethod {
  const allowed: EventPaymentMethod[] = ['CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER', 'COMPLIMENTARY', 'OTHER'];
  return allowed.includes(method as EventPaymentMethod) ? method as EventPaymentMethod : 'OTHER';
}

function assertOperationalEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED' || status === 'FINISHED') {
    throw new EventsError('EVENTO_BLOQUEADO', 'Este evento não aceita novas alterações operacionais.', 409);
  }
}

export type CancelOpenEventParticipantCharges = (_input: {
  contaId: string;
  chargeIds: string[];
}) => Promise<void>;

export async function unregisterEventParticipant(
  ctx: EventsContext,
  eventId: string,
  participantId: string,
  cancelOpenCharges?: CancelOpenEventParticipantCharges,
) {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    select: { ...eventParticipantScalarSelect, event: true },
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
      return unregisterEventParticipantGroup(ctx, eventId, participant.billingGroupId, cancelOpenCharges);
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
  const chargesToCancel = openCharges.filter((charge) => charge.asaasPaymentId);
  if (chargesToCancel.length > 0) {
    if (!cancelOpenCharges) throw new Error('Event charge cancellation use case not provided');
    await cancelOpenCharges({ contaId: ctx.contaId, chargeIds: chargesToCancel.map((charge) => charge.id) });
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
      select: eventParticipantScalarSelect,
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

export async function unregisterEventParticipantGroup(
  ctx: EventsContext,
  eventId: string,
  billingGroupId: string,
  cancelOpenCharges?: CancelOpenEventParticipantCharges,
) {
  const group = await prisma.eventBillingGroup.findFirst({
    where: { id: billingGroupId, contaId: ctx.contaId, eventId },
    include: { event: true, participants: { select: eventParticipantScalarSelect } },
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
  const chargesToCancel = openCharges.filter((charge) => charge.asaasPaymentId);
  if (chargesToCancel.length > 0) {
    if (!cancelOpenCharges) throw new Error('Event charge cancellation use case not provided');
    await cancelOpenCharges({ contaId: ctx.contaId, chargeIds: chargesToCancel.map((charge) => charge.id) });
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
        select: eventParticipantScalarSelect,
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


export async function reactivateEventParticipant(
  ctx: EventsContext,
  eventId: string,
  participantId: string,
  input: ReactivateEventParticipantInput,
) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.eventParticipant.findFirst({
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

    if (feeCharged > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId,
          type: 'REVENUE',
          originType: 'EVENT_REGISTRATION',
          category: 'Taxa de inscrição',
          description: billingMode === 'ENTRY_INSTALLMENT' ? 'Entrada da taxa de inscrição' : 'Taxa de inscrição',
          expectedAmount: decimal(feeCharged),
          grossAmount: decimal(toMoney(participant.registrationFeeOriginal)),
          discountAmount: decimal(toMoney(participant.registrationFeeDiscount)),
          actualAmount: entryAmount > 0 ? decimal(entryAmount) : null,
          dueDate,
          realizedAt: entryAmount > 0 ? new Date() : null,
          status: entryAmount >= feeCharged ? 'RECEIVED' : 'PENDING',
          paymentMethod: entryAmount > 0 ? mapToEventPaymentMethod(input.entryPaymentMethod ?? input.feePaymentMethod) : null,
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
      select: eventParticipantScalarSelect,
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
