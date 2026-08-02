import { calculateBillingAgreementDesiredState } from '@alusa/domain';

import { BillingAgreementError } from './errors';
import { stableFinancialHash } from './fingerprint';
import { assertMoneyCents, sumMoneyCents } from './money';
import type {
  BillingAgreement,
  BillingAgreementChangeInput,
  BillingAgreementChangePreview,
  BillingAgreementContext,
  BillingAgreementPlan,
  BillingAllocation,
  BillingAllocationDraft,
  BillingCharge,
  BillingChargeImpact,
  PaidDecreaseHandling,
  ProposedBillingAdjustment,
} from './types';

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const PENDING_STATUSES = new Set(['PENDING']);

function parseDateOnly(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BillingAgreementError('INVALID_INPUT', `${field} deve usar o formato YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BillingAgreementError('INVALID_INPUT', `${field} é inválida.`);
  }
  return date;
}

function assertTenant(context: BillingAgreementContext, contaId: string): void {
  if (
    context.agreement.contaId !== contaId ||
    context.allocations.some((allocation) => allocation.contaId !== contaId) ||
    context.charges.some((charge) => charge.contaId !== contaId)
  ) {
    throw new BillingAgreementError('TENANT_MISMATCH', 'O acordo contém referências de outra conta.');
  }
}

function isAllocationEffective(allocation: BillingAllocation, effectiveDate: string): boolean {
  if (allocation.status !== 'ACTIVE' && allocation.status !== 'SCHEDULED') return false;
  if (allocation.validFrom > effectiveDate) return false;
  // Vigência financeira é intervalo semiaberto [validFrom, validUntil).
  return allocation.validUntil === null || allocation.validUntil > effectiveDate;
}

function validateAllocationMoney(input: {
  baseAmountCents: number;
  discountAmountCents?: number;
  netAmountCents: number;
}): void {
  const discount = input.discountAmountCents ?? 0;
  assertMoneyCents(input.baseAmountCents, 'baseAmountCents', { allowZero: true });
  assertMoneyCents(discount, 'discountAmountCents', { allowZero: true });
  assertMoneyCents(input.netAmountCents, 'netAmountCents', { allowZero: true });
  if (discount > input.baseAmountCents || input.netAmountCents !== input.baseAmountCents - discount) {
    throw new BillingAgreementError(
      'INVALID_INPUT',
      'O valor líquido deve corresponder ao valor-base menos o desconto.',
    );
  }
}

function activeRecurringTotal(allocations: BillingAllocation[], effectiveDate: string): number {
  return sumMoneyCents(
    allocations
      .filter((allocation) => allocation.recurring && isAllocationEffective(allocation, effectiveDate))
      .map((allocation) => allocation.netAmountCents),
  );
}

function allocationFromDraft(input: {
  draft: BillingAllocationDraft;
  context: BillingAgreementContext;
  effectiveDate: string;
  id: string;
}): BillingAllocation {
  validateAllocationMoney(input.draft);
  return {
    id: input.id,
    contaId: input.context.agreement.contaId,
    agreementId: input.context.agreement.id,
    enrollmentId: input.draft.enrollmentId,
    studentId: input.draft.studentId,
    kind: input.draft.kind,
    status: input.draft.validFrom && input.draft.validFrom > input.effectiveDate ? 'SCHEDULED' : 'ACTIVE',
    recurring: input.draft.recurring ?? input.draft.kind === 'TUITION',
    baseAmountCents: input.draft.baseAmountCents,
    discountAmountCents: input.draft.discountAmountCents ?? 0,
    netAmountCents: input.draft.netAmountCents,
    validFrom: input.draft.validFrom ?? input.effectiveDate,
    validUntil: input.draft.validUntil ?? null,
    prorationPolicy: input.draft.prorationPolicy ?? 'FULL_CURRENT_CYCLE',
  };
}

type Projection = {
  sourceAllocations: BillingAllocation[];
  targetAllocations: BillingAllocation[] | null;
  sourceAddedCents: number;
  sourceRemovedCents: number;
  targetAddedCents: number;
  targetRemovedCents: number;
};

function projectAllocations(input: {
  source: BillingAgreementContext;
  target: BillingAgreementContext | null;
  change: BillingAgreementChangeInput;
}): Projection {
  const { source, target, change } = input;
  const sourceAllocations = source.allocations.map((allocation) => ({ ...allocation }));
  const targetAllocations = target?.allocations.map((allocation) => ({ ...allocation })) ?? null;
  const activeById = new Map(
    sourceAllocations
      .filter((allocation) => isAllocationEffective(allocation, change.effectiveDate))
      .map((allocation) => [allocation.id, allocation]),
  );
  let sourceAddedCents = 0;
  let sourceRemovedCents = 0;
  let targetAddedCents = 0;
  const targetRemovedCents = 0;

  const assertDistinctIds = (ids: string[]) => {
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      throw new BillingAgreementError('INVALID_INPUT', 'Informe alocações distintas para a operação.');
    }
  };
  const endAllocations = (ids: string[]) => {
    assertDistinctIds(ids);
    for (const id of ids) {
      const allocation = activeById.get(id);
      if (!allocation) {
        throw new BillingAgreementError('ALLOCATION_NOT_FOUND', 'Alocação ativa não encontrada.', {
          allocationId: id,
        });
      }
      allocation.validUntil = change.effectiveDate;
      if (allocation.recurring) sourceRemovedCents += allocation.netAmountCents;
    }
  };

  if (change.kind === 'ADD_ALLOCATION') {
    if (change.allocations.length === 0) {
      throw new BillingAgreementError('INVALID_INPUT', 'Informe ao menos uma alocação.');
    }
    const activeKeys = new Set(
      sourceAllocations
        .filter((allocation) => allocation.recurring && isAllocationEffective(allocation, change.effectiveDate))
        .map((allocation) => `${allocation.enrollmentId}:${allocation.kind}`),
    );
    change.allocations.forEach((draft, index) => {
      const allocation = allocationFromDraft({
        draft,
        context: source,
        effectiveDate: change.effectiveDate,
        id: `new:${draft.clientId ?? index}`,
      });
      const key = `${allocation.enrollmentId}:${allocation.kind}`;
      if (allocation.recurring && activeKeys.has(key)) {
        throw new BillingAgreementError(
          'INVALID_INPUT',
          'A matrícula já possui alocação ativa da mesma natureza neste acordo.',
          { enrollmentId: allocation.enrollmentId, kind: allocation.kind },
        );
      }
      activeKeys.add(key);
      sourceAllocations.push(allocation);
      if (allocation.recurring) sourceAddedCents += allocation.netAmountCents;
    });
  } else if (change.kind === 'RESUME_ALLOCATION') {
    assertDistinctIds(change.allocationIds);
    for (const [index, id] of change.allocationIds.entries()) {
      const paused = sourceAllocations.find(
        (allocation) => allocation.id === id && allocation.status === 'PAUSED',
      );
      if (!paused) {
        throw new BillingAgreementError('ALLOCATION_NOT_FOUND', 'Alocação pausada não encontrada.', {
          allocationId: id,
        });
      }
      sourceAllocations.push({
        ...paused,
        id: `resume:${id}:${index}`,
        status: 'ACTIVE',
        validFrom: change.effectiveDate,
        validUntil: null,
      });
      if (paused.recurring) sourceAddedCents += paused.netAmountCents;
    }
  } else if (change.kind === 'REMOVE_ALLOCATION') {
    endAllocations(change.allocationIds);
  } else if (change.kind === 'PAUSE_ALLOCATION') {
    assertDistinctIds(change.allocationIds);
    for (const id of change.allocationIds) {
      const allocation = activeById.get(id);
      if (!allocation) {
        throw new BillingAgreementError('ALLOCATION_NOT_FOUND', 'Alocação ativa não encontrada.', {
          allocationId: id,
        });
      }
      allocation.validUntil = change.effectiveDate;
      allocation.status = 'PAUSED';
      if (allocation.recurring) sourceRemovedCents += allocation.netAmountCents;
    }
  } else if (change.kind === 'TRANSFER_ALLOCATION') {
    if (!target || !targetAllocations) {
      throw new BillingAgreementError('TARGET_AGREEMENT_NOT_FOUND', 'Acordo financeiro de destino não encontrado.');
    }
    assertDistinctIds(change.allocationIds);
    for (const [index, id] of change.allocationIds.entries()) {
      const allocation = activeById.get(id);
      if (!allocation) {
        throw new BillingAgreementError('ALLOCATION_NOT_FOUND', 'Alocação ativa não encontrada.', {
          allocationId: id,
        });
      }
      allocation.validUntil = change.effectiveDate;
      if (allocation.recurring) {
        sourceRemovedCents += allocation.netAmountCents;
        targetAddedCents += allocation.netAmountCents;
      }
      targetAllocations.push({
        ...allocation,
        id: `transfer:${id}:${index}`,
        agreementId: target.agreement.id,
        validFrom: change.effectiveDate,
        validUntil: null,
        status: 'ACTIVE',
      });
    }
  } else if (change.kind === 'UPDATE_ALLOCATION') {
    if (change.allocations.length === 0) {
      throw new BillingAgreementError('INVALID_INPUT', 'Informe ao menos uma alocação para alterar.');
    }
    const ids = change.allocations.map((allocation) => allocation.allocationId);
    assertDistinctIds(ids);
    change.allocations.forEach((update, index) => {
      validateAllocationMoney(update);
      const current = activeById.get(update.allocationId);
      if (!current) {
        throw new BillingAgreementError('ALLOCATION_NOT_FOUND', 'Alocação ativa não encontrada.', {
          allocationId: update.allocationId,
        });
      }
      current.validUntil = change.effectiveDate;
      const recurring = update.recurring ?? current.recurring;
      if (current.recurring) sourceRemovedCents += current.netAmountCents;
      if (recurring) sourceAddedCents += update.netAmountCents;
      sourceAllocations.push({
        ...current,
        id: `update:${current.id}:${index}`,
        status: 'ACTIVE',
        recurring,
        baseAmountCents: update.baseAmountCents,
        discountAmountCents: update.discountAmountCents ?? 0,
        netAmountCents: update.netAmountCents,
        validFrom: update.validFrom ?? change.effectiveDate,
        validUntil: update.validUntil ?? null,
        prorationPolicy: update.prorationPolicy ?? current.prorationPolicy,
      });
    });
  } else if (change.kind === 'CANCEL_AGREEMENT') {
    for (const allocation of sourceAllocations) {
      if (!isAllocationEffective(allocation, change.effectiveDate)) continue;
      allocation.validUntil = change.effectiveDate;
      if (allocation.recurring) sourceRemovedCents += allocation.netAmountCents;
    }
  }

  return {
    sourceAllocations,
    targetAllocations,
    sourceAddedCents,
    sourceRemovedCents,
    targetAddedCents,
    targetRemovedCents,
  };
}

function chargeWithinCurrentCycle(context: BillingAgreementContext): BillingCharge | null {
  if (!context.currentCycle) return null;
  return (
    context.charges
      .filter(
        (charge) =>
          charge.dueDate >= context.currentCycle!.startsAt &&
          charge.dueDate < context.currentCycle!.endsAt,
      )
      .sort((left, right) => right.dueDate.localeCompare(left.dueDate))[0] ?? null
  );
}

function chargeState(charge: BillingCharge | null) {
  if (!charge) return 'NOT_GENERATED' as const;
  if (PENDING_STATUSES.has(charge.status)) return 'PENDING' as const;
  if (charge.status === 'OVERDUE') return 'OVERDUE' as const;
  if (PAID_STATUSES.has(charge.status)) return 'PAID' as const;
  if (charge.status === 'REFUNDED') return 'REFUNDED' as const;
  return 'CANCELLED' as const;
}

function mapAdjustment(input: {
  agreementId: string;
  charge: BillingCharge | null;
  effectiveDate: string;
  adjustment: {
    type: 'NONE' | 'CREDIT' | 'COMPLEMENT' | 'REFUND' | 'MANUAL_REVIEW';
    amountCents: number;
    reason: string;
  };
}): ProposedBillingAdjustment[] {
  if (input.adjustment.type === 'NONE' || input.adjustment.amountCents === 0) return [];
  return [
    {
      agreementId: input.agreementId,
      chargeId: input.charge?.id ?? null,
      type: input.adjustment.type,
      amountCents: input.adjustment.amountCents,
      effectiveDate: input.effectiveDate,
      reason:
        input.adjustment.reason === 'PAID_CHARGE_IS_IMMUTABLE'
          ? 'PAID_CHARGE_IMMUTABLE'
          : input.adjustment.reason === 'MANUAL_POLICY' ||
              input.adjustment.reason === 'OVERDUE_CHARGE_REQUIRES_REVIEW'
            ? 'MANUAL_POLICY'
            : input.adjustment.type === 'CREDIT' || input.adjustment.type === 'REFUND'
              ? 'CANCELLATION_AFTER_PAYMENT'
              : 'PRORATION',
    },
  ];
}

function mapSubscriptionAction(input: {
  action:
    | 'NONE'
    | 'CREATE'
    | 'UPDATE'
    | 'PAUSE'
    | 'RESUME'
    | 'CANCEL'
    | 'SCHEDULE_UPDATE'
    | 'SCHEDULE_PAUSE'
    | 'SCHEDULE_RESUME'
    | 'SCHEDULE_CANCEL';
  change: BillingAgreementChangeInput;
  agreement: BillingAgreement;
  resultingAmountCents: number;
}): BillingAgreementPlan['remoteAction'] {
  if (input.action.startsWith('SCHEDULE_')) {
    const scheduled = {
      SCHEDULE_UPDATE: 'SCHEDULE_UPDATE',
      SCHEDULE_PAUSE: 'SCHEDULE_PAUSE',
      SCHEDULE_RESUME: 'SCHEDULE_RESUME',
      SCHEDULE_CANCEL: 'SCHEDULE_CANCEL',
    } as const;
    return scheduled[input.action as keyof typeof scheduled];
  }
  if (input.change.kind === 'CANCEL_AGREEMENT') {
    return input.agreement.asaasSubscriptionId ? 'DELETE_SUBSCRIPTION' : 'NONE';
  }
  if (input.change.kind === 'CHANGE_PAYER' && input.agreement.asaasSubscriptionId) {
    return 'REPLACE_SUBSCRIPTION';
  }
  if (input.change.kind === 'PAUSE_AGREEMENT' || (input.change.kind === 'PAUSE_ALLOCATION' && input.resultingAmountCents === 0)) {
    return input.agreement.asaasSubscriptionId ? 'PAUSE_SUBSCRIPTION' : 'NONE';
  }
  if (input.change.kind === 'RESUME_AGREEMENT' || input.change.kind === 'RESUME_ALLOCATION') {
    if (!input.agreement.asaasSubscriptionId) return input.resultingAmountCents > 0 ? 'CREATE_SUBSCRIPTION' : 'NONE';
    if (input.agreement.status === 'INACTIVE') return 'RESUME_SUBSCRIPTION';
  }
  const mapping: Record<typeof input.action, BillingAgreementPlan['remoteAction']> = {
    NONE: 'NONE',
    CREATE: 'CREATE_SUBSCRIPTION',
    UPDATE: 'UPDATE_SUBSCRIPTION',
    PAUSE: 'PAUSE_SUBSCRIPTION',
    RESUME: 'RESUME_SUBSCRIPTION',
    CANCEL: 'DELETE_SUBSCRIPTION',
    SCHEDULE_UPDATE: 'SCHEDULE_UPDATE',
    SCHEDULE_PAUSE: 'SCHEDULE_PAUSE',
    SCHEDULE_RESUME: 'SCHEDULE_RESUME',
    SCHEDULE_CANCEL: 'SCHEDULE_CANCEL',
  };
  return mapping[input.action];
}

function buildChargeImpacts(input: {
  context: BillingAgreementContext;
  resultingAmountCents: number;
  updatePendingPayments: boolean;
  change: BillingAgreementChangeInput;
}): { impacts: BillingChargeImpact[]; warnings: string[] } {
  const warnings: string[] = [];
  const cancellation = input.resultingAmountCents === 0;
  return {
    impacts: input.context.charges.map((charge) => {
      let action: BillingChargeImpact['action'] = 'PRESERVE';
      let targetAmountCents: number | null = null;
      if (input.change.effectivePolicy === 'CURRENT_CYCLE_FULL' && charge.status === 'PENDING') {
        action = cancellation ? 'CANCEL_PENDING' : 'UPDATE_WITH_SUBSCRIPTION';
        targetAmountCents = cancellation ? 0 : input.resultingAmountCents;
      } else if (input.change.effectivePolicy === 'CURRENT_CYCLE_FULL' && charge.status === 'OVERDUE') {
        action = 'MANUAL_REVIEW';
        warnings.push(`A cobrança vencida ${charge.id} exige revisão e não será alterada automaticamente.`);
      } else if (input.change.effectivePolicy === 'MANUAL_ADJUSTMENT') {
        action = 'MANUAL_REVIEW';
      }
      return {
        chargeId: charge.id,
        providerPaymentId: charge.providerPaymentId,
        status: charge.status,
        dueDate: charge.dueDate,
        amountCents: charge.amountCents,
        targetAmountCents,
        action,
      };
    }),
    warnings: [...new Set(warnings)],
  };
}

function buildPlan(input: {
  context: BillingAgreementContext;
  projectedAllocations: BillingAllocation[];
  addedAmountCents: number;
  removedAmountCents: number;
  change: BillingAgreementChangeInput;
  now: Date;
  payer?: BillingAgreement['payer'];
}): { plan: BillingAgreementPlan; warnings: string[] } {
  const currentCharge = chargeWithinCurrentCycle(input.context);
  const calculation = calculateBillingAgreementDesiredState({
    calculatedAt: input.now,
    effectiveAt: input.change.effectiveDate,
    effectivePolicy: input.change.effectivePolicy,
    agreement: {
      status: input.context.agreement.status,
      desiredAmountCents: input.context.agreement.desiredAmountCents,
      confirmedAmountCents: input.context.agreement.confirmedAmountCents,
      version: input.context.agreement.version,
      remoteSubscriptionExists: Boolean(input.context.agreement.asaasSubscriptionId),
      validFrom: input.context.agreement.validFrom,
      validUntil: input.context.agreement.validUntil,
    },
    allocations: input.projectedAllocations.map((allocation) => ({
      id: allocation.id,
      matriculaId: allocation.enrollmentId,
      alunoId: allocation.studentId,
      kind: allocation.kind,
      status: allocation.status,
      recurring: allocation.recurring,
      netAmountCents: allocation.netAmountCents,
      validFrom: allocation.validFrom,
      validUntil: allocation.validUntil,
    })),
    currentCharge: currentCharge
      ? { state: chargeState(currentCharge), amountCents: currentCharge.amountCents }
      : { state: 'NOT_GENERATED', amountCents: input.context.agreement.confirmedAmountCents },
    currentCycle: input.context.currentCycle,
    paidDecreaseHandling: input.change.paidDecreaseHandling ?? 'CREDIT',
  });
  if (!calculation.success) {
    throw new BillingAgreementError('INVALID_INPUT', calculation.message, {
      domainError: calculation.error,
      allocationId: calculation.allocationId,
    });
  }
  const desired = calculation.value;
  // updatePendingPayments no Asaas é global. Com vencida presente, o serviço
  // atualiza somente pagamentos PENDING elegíveis, individualmente.
  const hasOverdue = input.context.charges.some((charge) => charge.status === 'OVERDUE');
  const updatePendingPayments = desired.updatePendingPayments && !hasOverdue;
  const impactResult = buildChargeImpacts({
    context: input.context,
    resultingAmountCents: desired.desiredRecurringAmountCents,
    updatePendingPayments,
    change: input.change,
  });
  const warnings = [...impactResult.warnings];
  const activeTotal = activeRecurringTotal(input.context.allocations, input.change.effectiveDate);
  if (activeTotal !== input.context.agreement.desiredAmountCents) {
    warnings.push('A soma das alocações diverge do valor desejado persistido e será reconciliada.');
  }
  const adjustments = mapAdjustment({
    agreementId: input.context.agreement.id,
    charge: currentCharge,
    effectiveDate: input.change.effectiveDate,
    adjustment: desired.adjustment,
  });
  return {
    plan: {
      agreementId: input.context.agreement.id,
      sourceVersion: input.context.agreement.version,
      agreementValidFrom: desired.agreementValidFrom?.slice(0, 10) ?? null,
      agreementValidUntil: desired.agreementValidUntil?.slice(0, 10) ?? null,
      previousAmountCents: activeTotal,
      resultingAmountCents: desired.desiredRecurringAmountCents,
      addedAmountCents: input.addedAmountCents,
      removedAmountCents: input.removedAmountCents,
      remoteAction: mapSubscriptionAction({
        action: desired.subscriptionAction,
        change: input.change,
        agreement: input.context.agreement,
        resultingAmountCents: desired.desiredRecurringAmountCents,
      }),
      updatePendingPayments,
      payer: input.payer ?? input.context.agreement.payer,
      chargeImpacts: impactResult.impacts,
      adjustments,
    },
    warnings: [...new Set(warnings)],
  };
}

export function calculateBillingAgreementChangePreview(input: {
  change: BillingAgreementChangeInput;
  sourceContext: BillingAgreementContext;
  targetContext?: BillingAgreementContext | null;
  now: Date;
  previewTtlMs: number;
}): BillingAgreementChangePreview {
  const { change, sourceContext } = input;
  parseDateOnly(change.effectiveDate, 'effectiveDate');
  if (change.reason.trim().length < 3) {
    throw new BillingAgreementError('INVALID_INPUT', 'Informe uma justificativa para a alteração financeira.');
  }
  assertTenant(sourceContext, change.contaId);
  if (sourceContext.agreement.id !== change.agreementId) {
    throw new BillingAgreementError('AGREEMENT_NOT_FOUND', 'Acordo financeiro não encontrado.');
  }
  const targetContext = input.targetContext ?? null;
  if (change.kind === 'TRANSFER_ALLOCATION') {
    if (!targetContext || targetContext.agreement.id !== change.targetAgreementId) {
      throw new BillingAgreementError('TARGET_AGREEMENT_NOT_FOUND', 'Acordo financeiro de destino não encontrado.');
    }
    assertTenant(targetContext, change.contaId);
    if (targetContext.agreement.id === sourceContext.agreement.id) {
      throw new BillingAgreementError('INVALID_INPUT', 'Origem e destino precisam ser diferentes.');
    }
  }

  const projection = projectAllocations({ source: sourceContext, target: targetContext, change });
  const source = buildPlan({
    context: sourceContext,
    projectedAllocations: projection.sourceAllocations,
    addedAmountCents: projection.sourceAddedCents,
    removedAmountCents: projection.sourceRemovedCents,
    change,
    now: input.now,
    payer: change.kind === 'CHANGE_PAYER' ? change.newPayer : undefined,
  });
  const plans = [source.plan];
  const warnings = [...source.warnings];
  if (change.kind === 'TRANSFER_ALLOCATION' && targetContext && projection.targetAllocations) {
    const target = buildPlan({
      context: targetContext,
      projectedAllocations: projection.targetAllocations,
      addedAmountCents: projection.targetAddedCents,
      removedAmountCents: projection.targetRemovedCents,
      change,
      now: input.now,
    });
    plans.push(target.plan);
    warnings.push(...target.warnings);
  }
  const blockers: string[] = [];
  for (const plan of plans) {
    if (plan.resultingAmountCents > 0 && !plan.payer.customerId) {
      blockers.push('O pagador precisa possuir customer financeiro antes da operação.');
    }
    if (plan.adjustments.some((adjustment) => adjustment.type === 'REFUND' && !adjustment.chargeId)) {
      blockers.push('O reembolso exige uma cobrança paga identificada no ciclo atual.');
    }
  }
  const hashPayload = {
    change: { ...change, paidDecreaseHandling: change.paidDecreaseHandling ?? ('CREDIT' satisfies PaidDecreaseHandling) },
    plans: plans.map((plan) => ({
      agreementId: plan.agreementId,
      sourceVersion: plan.sourceVersion,
      agreementValidFrom: plan.agreementValidFrom,
      agreementValidUntil: plan.agreementValidUntil,
      previousAmountCents: plan.previousAmountCents,
      resultingAmountCents: plan.resultingAmountCents,
      remoteAction: plan.remoteAction,
      updatePendingPayments: plan.updatePendingPayments,
      payer: plan.payer,
      chargeImpacts: plan.chargeImpacts,
      adjustments: plan.adjustments,
    })),
  };
  return {
    contaId: change.contaId,
    kind: change.kind,
    agreementId: change.agreementId,
    targetAgreementId: change.kind === 'TRANSFER_ALLOCATION' ? change.targetAgreementId : null,
    effectivePolicy: change.effectivePolicy,
    effectiveDate: change.effectiveDate,
    sourceVersion: sourceContext.agreement.version,
    previewHash: stableFinancialHash(hashPayload),
    expiresAt: new Date(input.now.getTime() + input.previewTtlMs).toISOString(),
    plans,
    currentAmountCents: sumMoneyCents(plans.map((plan) => plan.previousAmountCents)),
    addedAmountCents: sumMoneyCents(plans.map((plan) => plan.addedAmountCents)),
    removedAmountCents: sumMoneyCents(plans.map((plan) => plan.removedAmountCents)),
    resultingAmountCents: sumMoneyCents(plans.map((plan) => plan.resultingAmountCents)),
    affectedCharges: plans.flatMap((plan) => plan.chargeImpacts),
    adjustments: plans.flatMap((plan) => plan.adjustments),
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
  };
}
