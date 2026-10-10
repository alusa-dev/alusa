import { Prisma, type EventPaymentMethod } from '@prisma/client';
import { prisma } from '@alusa/database';
import { EventsError, normalizeEventFinancialLine } from '@alusa/domain/events';
import { eventParticipantScalarSelect } from '@alusa/lib/events/event-financial-read-models';
import { buildEventParticipantRemovalDecision } from '@alusa/lib/events/event-participant-removal-decision.service';
import { recordEventAudit } from '@alusa/lib/events/event-audit.service';
import { createEventContractForParticipant } from '@alusa/lib/events/event-contracts.service';
import { eventPaymentRulesFromRecord } from '@alusa/lib/events/events-payment-rules';
import type { CreateEventParticipantInput } from '@alusa/lib/events/events.schema';

type EventsContext = { contaId: string; userId: string };

export type RegisterEventParticipantGroupInput = CreateEventParticipantInput & {
  alunoIds: string[];
  responsavelId: string;
  registrationFeeOriginalTotal?: number;
  registrationFeeDiscountTotal?: number;
  registrationFeeChargedTotal?: number;
  billingMethod?: string | null;
  chargeType?: string | null;
  installmentCount?: number | null;
  dueDate?: Date | null;
  uiRequestId?: string | null;
};

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

function normalizeFinancialLineOrThrow(input: Parameters<typeof normalizeEventFinancialLine>[0]) {
  try {
    return normalizeEventFinancialLine(input);
  } catch (error) {
    throw new EventsError(
      'LANCAMENTO_INCONSISTENTE',
      error instanceof Error ? error.message : 'Valores financeiros inconsistentes.',
      422,
    );
  }
}

function assertOperationalEvent(status: string) {
  if (status === 'CANCELLED' || status === 'ARCHIVED' || status === 'FINISHED') {
    throw new EventsError('EVENTO_BLOQUEADO', 'Este evento não aceita novas alterações operacionais.', 409);
  }
}

export async function registerEventParticipant(ctx: EventsContext, input: CreateEventParticipantInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`event-participant:${ctx.contaId}:${input.eventId}:${input.alunoId}`}, 0))`;
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
      select: {
        ...eventParticipantScalarSelect,
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
    const feeLine = normalizeFinancialLineOrThrow({
      expectedAmount: input.registrationFeeCharged,
      grossAmount: input.registrationFeeOriginal,
      discountAmount: input.registrationFeeDiscount,
    });
    const feeOriginal = feeLine.grossAmount;
    const feeDiscount = feeLine.discountAmount;
    const feeCharged = feeLine.netAmount;
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

    // Every billable registration has one local obligation. The Asaas charge
    // is only the payment channel; keeping the obligation locally makes the
    // event forecast complete and lets webhook snapshots update realization
    // without creating a second revenue source.
    if (feeCharged > 0) {
      const entry = await tx.eventFinancialEntry.create({
        data: {
          contaId: ctx.contaId,
          eventId: input.eventId,
          type: 'REVENUE',
          originType: 'EVENT_REGISTRATION',
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
      select: eventParticipantScalarSelect,
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

    // Serialize registrations for the same event/student set. The locks are
    // transaction-scoped and acquired in deterministic order to avoid races
    // without relying on process-local state in serverless instances.
    for (const alunoId of [...alunoIds].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`event-participant:${ctx.contaId}:${input.eventId}:${alunoId}`}, 0))`;
    }

    if (input.uiRequestId) {
      const existingGroup = await tx.eventBillingGroup.findFirst({
        where: { contaId: ctx.contaId, uiRequestId: input.uiRequestId },
        include: { participants: { select: eventParticipantScalarSelect } },
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
    const totalOriginalAmount = toMoney(input.registrationFeeOriginalTotal ?? feeOriginalPerParticipant * alunoIds.length);
    const totalAmount = toMoney(input.registrationFeeChargedTotal ?? toMoney(input.registrationFeeCharged ?? feeOriginalPerParticipant) * alunoIds.length);
    const totalDiscountAmount = toMoney(input.registrationFeeDiscountTotal ?? input.registrationFeeDiscount ?? Math.max(totalOriginalAmount - totalAmount, 0));
    const totalLine = normalizeFinancialLineOrThrow({
      expectedAmount: totalAmount,
      grossAmount: totalOriginalAmount,
      discountAmount: totalDiscountAmount,
    });
    const normalizedTotalOriginalAmount = totalLine.grossAmount;
    const normalizedTotalAmount = totalLine.netAmount;
    const normalizedTotalDiscountAmount = totalLine.discountAmount;
    const originalAllocations = allocateGroupAmount(normalizedTotalOriginalAmount, alunoIds.map(() => feeOriginalPerParticipant));
    const chargedAllocations = allocateGroupAmount(normalizedTotalAmount, originalAllocations);
    const discountAllocations = originalAllocations.map((original, index) => toMoney(original - (chargedAllocations[index] ?? 0)));
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
    const entryAllocations = allocateGroupAmount(entryAmount, chargedAllocations);
    const group = await tx.eventBillingGroup.create({
      data: {
        contaId: ctx.contaId,
        eventId: input.eventId,
        responsavelId: input.responsavelId,
        status: entryAmount >= totalAmount && totalAmount > 0 ? 'PAID' : entryAmount > 0 ? 'PARTIALLY_PAID' : 'PENDING',
        billingMode,
        totalAmount: decimal(normalizedTotalAmount),
        originalAmount: decimal(normalizedTotalOriginalAmount),
        discountAmount: decimal(normalizedTotalDiscountAmount),
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
      // Persist one obligation per participant. For digital grouped charges,
      // the payment is reconciled later from the group charge; for manual
      // registrations, allocatedEntry is the amount received now.
      const participantEntry = (chargedAllocations[index] ?? 0) > 0
        ? await tx.eventFinancialEntry.create({
            data: {
              contaId: ctx.contaId,
              eventId: input.eventId,
              type: 'REVENUE',
              originType: 'EVENT_REGISTRATION',
              category: 'Taxa de inscrição',
              description: input.billingMethod === 'MANUAL_RECEIVED' && allocatedEntry > 0
                ? 'Entrada manual da cobrança agrupada do evento'
                : 'Taxa de inscrição agrupada do evento',
              // The entry represents the participant's full obligation. The
              // payment amount is only the amount received now; otherwise a
              // grouped registration with an entry would disappear from the
              // event forecast after creation.
              expectedAmount: decimal(chargedAllocations[index] ?? 0),
              grossAmount: decimal(originalAllocations[index] ?? 0),
              discountAmount: decimal(discountAllocations[index] ?? 0),
              actualAmount: allocatedEntry > 0 ? decimal(allocatedEntry) : null,
              dueDate: input.dueDate ?? new Date(),
              realizedAt: allocatedEntry > 0 ? new Date() : null,
              status: allocatedEntry >= (chargedAllocations[index] ?? 0) ? 'RECEIVED' : 'PENDING',
              paymentMethod: allocatedEntry > 0 ? mapToEventPaymentMethod(input.entryPaymentMethod ?? input.feePaymentMethod) : null,
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
          registrationFeeCharged: decimal(chargedAllocations[index] ?? 0),
          registrationFeeOriginal: decimal(originalAllocations[index] ?? 0),
          registrationFeeDiscount: decimal(discountAllocations[index] ?? 0),
          registrationFeeDiscountType: input.registrationFeeDiscountType ?? null,
          billingMode,
          entryAmount: decimal(allocatedEntry),
          balanceAmount: decimal(Math.max((chargedAllocations[index] ?? 0) - allocatedEntry, 0)),
          entryPaymentMethod: allocatedEntry > 0 ? (input.entryPaymentMethod ?? input.feePaymentMethod ?? null) : null,
          registrationPaymentRules: registrationPaymentRules ?? Prisma.JsonNull,
          isFeePaid,
          isFeeExempt: input.isFeeExempt ?? false,
          feePaymentMethod: input.entryPaymentMethod ?? input.feePaymentMethod ?? null,
          revenueEntryId: participantEntry?.id ?? null,
          feePaidAmount: decimal(allocatedEntry),
          notes: input.notes,
        },
        select: eventParticipantScalarSelect,
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

export async function rollbackEventParticipantRegistration(input: {
  contaId: string;
  participantId: string;
  revenueEntryId: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.eventoContrato.deleteMany({
      where: { contaId: input.contaId, participantId: input.participantId, status: 'PENDENTE' },
    });
    await tx.eventParticipant.deleteMany({
      where: { id: input.participantId, contaId: input.contaId },
    });
    if (input.revenueEntryId) {
      await tx.eventFinancialEntry.deleteMany({
        where: { id: input.revenueEntryId, contaId: input.contaId },
      });
    }
  });
}

export async function rollbackEventParticipantGroupRegistration(input: {
  contaId: string;
  groupId: string;
  participantIds: string[];
  revenueEntryIds: string[];
}) {
  return prisma.$transaction(async (tx) => {
    await tx.eventoContrato.deleteMany({
      where: { contaId: input.contaId, participantId: { in: input.participantIds }, status: 'PENDENTE' },
    });
    if (input.revenueEntryIds.length > 0) {
      await tx.eventFinancialEntry.deleteMany({
        where: { contaId: input.contaId, id: { in: input.revenueEntryIds } },
      });
    }
    await tx.eventParticipant.deleteMany({
      where: { contaId: input.contaId, id: { in: input.participantIds } },
    });
    await tx.eventBillingGroup.deleteMany({
      where: { contaId: input.contaId, id: input.groupId, status: 'PENDING' },
    });
  });
}

export async function markEventParticipantGroupForReconciliation(input: {
  contaId: string;
  groupId: string;
}) {
  return prisma.eventBillingGroup.updateMany({
    where: { id: input.groupId, contaId: input.contaId, status: 'PENDING' },
    data: { status: 'REQUIRES_RECONCILIATION' },
  });
}

export async function markEventParticipantGroupPaid(input: {
  contaId: string;
  groupId: string;
}) {
  return prisma.eventBillingGroup.updateMany({
    where: { id: input.groupId, contaId: input.contaId },
    data: { status: 'PAID' },
  });
}
