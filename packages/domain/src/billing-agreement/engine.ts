import { isMoneyCents } from './money.js';
import { prorateMoneyByDays } from './proration.js';
import type {
  BillingAgreementAllocationInput,
  BillingCurrentCycleAdjustment,
  BillingSubscriptionAction,
  CalculateBillingAgreementDesiredStateInput,
  CalculateBillingAgreementDesiredStateResult,
  CurrentChargeSnapshot,
} from './types.js';

function parseDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEffectiveAt(allocation: BillingAgreementAllocationInput, at: Date): boolean {
  if (
    allocation.status === 'CANCELLED' ||
    allocation.status === 'ENDED' ||
    allocation.status === 'PAUSED'
  ) {
    return false;
  }
  const startsAt = parseDate(allocation.validFrom);
  const endsAt = allocation.validUntil == null ? null : parseDate(allocation.validUntil);
  return startsAt != null && startsAt <= at && (endsAt == null || endsAt > at);
}

function participatesInAggregateValidity(
  allocation: BillingAgreementAllocationInput,
  at: Date,
): boolean {
  if (
    !allocation.recurring ||
    allocation.status === 'CANCELLED' ||
    allocation.status === 'ENDED' ||
    allocation.status === 'PAUSED'
  ) {
    return false;
  }

  const endsAt = allocation.validUntil == null ? null : parseDate(allocation.validUntil);
  return endsAt == null || endsAt > at;
}

/**
 * Deriva a janela que a assinatura remota precisa suportar a partir do
 * conjunto inteiro de alocações, nunca a partir de uma matrícula isolada.
 *
 * A janela é semiaberta. O começo é o menor `validFrom` ainda relevante e o
 * fim é o maior `validUntil`; qualquer alocação sem fim mantém o acordo sem
 * limite final. Lacunas intermediárias continuam sendo tratadas pelas
 * alterações agendadas de valor/status do acordo.
 */
function calculateAggregateValidity(
  allocations: BillingAgreementAllocationInput[],
  at: Date,
): { validFrom: string | null; validUntil: string | null } {
  const relevant = allocations.filter((allocation) =>
    participatesInAggregateValidity(allocation, at),
  );
  if (relevant.length === 0) {
    return { validFrom: null, validUntil: null };
  }

  const startsAt = relevant.map((allocation) => parseDate(allocation.validFrom)!);
  const hasOpenEnd = relevant.some((allocation) => allocation.validUntil == null);
  const endsAt = hasOpenEnd
    ? []
    : relevant.map((allocation) => parseDate(allocation.validUntil!)!);

  return {
    validFrom: new Date(Math.min(...startsAt.map((date) => date.getTime()))).toISOString(),
    validUntil: hasOpenEnd
      ? null
      : new Date(Math.max(...endsAt.map((date) => date.getTime()))).toISOString(),
  };
}

function decideSubscriptionAction(input: {
  agreement: CalculateBillingAgreementDesiredStateInput['agreement'];
  desiredAmountCents: number;
  isFutureEffective: boolean;
  hasPausedRecurringAllocation: boolean;
  agreementValidFrom: string | null;
  agreementValidUntil: string | null;
}): BillingSubscriptionAction {
  const { agreement, desiredAmountCents, isFutureEffective, hasPausedRecurringAllocation } = input;
  if (!agreement?.remoteSubscriptionExists) {
    if (desiredAmountCents === 0) return 'NONE';
    return isFutureEffective ? 'SCHEDULE_UPDATE' : 'CREATE';
  }

  if (desiredAmountCents === 0) {
    if (hasPausedRecurringAllocation) {
      if (agreement.status === 'INACTIVE') return 'NONE';
      return isFutureEffective ? 'SCHEDULE_PAUSE' : 'PAUSE';
    }
    return isFutureEffective ? 'SCHEDULE_CANCEL' : 'CANCEL';
  }

  if (agreement.status === 'INACTIVE') {
    return isFutureEffective ? 'SCHEDULE_RESUME' : 'RESUME';
  }

  const persistedValidFrom = agreement.validFrom ? parseDate(agreement.validFrom)?.toISOString() ?? null : null;
  const persistedValidUntil = agreement.validUntil ? parseDate(agreement.validUntil)?.toISOString() ?? null : null;
  const validityChanged =
    (agreement.validFrom !== undefined && persistedValidFrom !== input.agreementValidFrom) ||
    (agreement.validUntil !== undefined && persistedValidUntil !== input.agreementValidUntil);
  if (desiredAmountCents === agreement.confirmedAmountCents && !validityChanged) return 'NONE';
  return isFutureEffective ? 'SCHEDULE_UPDATE' : 'UPDATE';
}

function noAdjustment(
  reason: BillingCurrentCycleAdjustment['reason'],
): BillingCurrentCycleAdjustment {
  return { type: 'NONE', amountCents: 0, reason };
}

function decideCurrentCycleEffect(input: {
  charge: CurrentChargeSnapshot | null | undefined;
  deltaCents: number;
  policy: CalculateBillingAgreementDesiredStateInput['effectivePolicy'];
  paidDecreaseHandling: NonNullable<
    CalculateBillingAgreementDesiredStateInput['paidDecreaseHandling']
  >;
}): { updatePendingPayments: boolean; adjustment: BillingCurrentCycleAdjustment } {
  const { charge, deltaCents, policy, paidDecreaseHandling } = input;
  if (policy === 'NEXT_CYCLE') {
    return { updatePendingPayments: false, adjustment: noAdjustment('NEXT_CYCLE_ONLY') };
  }
  if (policy === 'MANUAL_ADJUSTMENT') {
    return {
      updatePendingPayments: false,
      adjustment:
        deltaCents === 0
          ? noAdjustment('NO_DIFFERENCE')
          : { type: 'MANUAL_REVIEW', amountCents: Math.abs(deltaCents), reason: 'MANUAL_POLICY' },
    };
  }
  if (deltaCents === 0) {
    return { updatePendingPayments: false, adjustment: noAdjustment('NO_DIFFERENCE') };
  }
  if (!charge || charge.state === 'NOT_GENERATED') {
    return { updatePendingPayments: false, adjustment: noAdjustment('NO_DIFFERENCE') };
  }
  if (charge.state === 'PENDING') {
    return {
      updatePendingPayments: true,
      adjustment: noAdjustment('PENDING_CHARGE_CAN_BE_UPDATED'),
    };
  }
  if (charge.state === 'OVERDUE') {
    return {
      updatePendingPayments: true,
      adjustment: noAdjustment('OVERDUE_CHARGE_CAN_BE_UPDATED'),
    };
  }
  if (charge.state === 'PAID') {
    if (deltaCents > 0) {
      return {
        updatePendingPayments: false,
        adjustment: {
          type: 'COMPLEMENT',
          amountCents: deltaCents,
          reason: 'PAID_CHARGE_IS_IMMUTABLE',
        },
      };
    }

    return {
      updatePendingPayments: false,
      adjustment: {
        type: paidDecreaseHandling,
        amountCents: Math.abs(deltaCents),
        reason: 'PAID_CHARGE_IS_IMMUTABLE',
      },
    };
  }

  return {
    updatePendingPayments: false,
    adjustment:
      deltaCents > 0
        ? {
            type: 'COMPLEMENT',
            amountCents: deltaCents,
            reason: 'CANCELLED_OR_REFUNDED_CHARGE',
          }
        : noAdjustment('CANCELLED_OR_REFUNDED_CHARGE'),
  };
}

export function calculateBillingAgreementDesiredState(
  input: CalculateBillingAgreementDesiredStateInput,
): CalculateBillingAgreementDesiredStateResult {
  const calculatedAt = parseDate(input.calculatedAt);
  const effectiveAt = parseDate(input.effectiveAt);
  if (!calculatedAt || !effectiveAt) {
    return { success: false, error: 'INVALID_DATE', message: 'Invalid calculation date.' };
  }
  if (input.agreement && (!Number.isSafeInteger(input.agreement.version) || input.agreement.version < 0)) {
    return { success: false, error: 'INVALID_VERSION', message: 'Invalid agreement version.' };
  }
  if (
    input.agreement &&
    (!isMoneyCents(input.agreement.desiredAmountCents) ||
      !isMoneyCents(input.agreement.confirmedAmountCents))
  ) {
    return { success: false, error: 'INVALID_MONEY', message: 'Invalid agreement amount.' };
  }
  if (input.currentCharge && !isMoneyCents(input.currentCharge.amountCents)) {
    return { success: false, error: 'INVALID_MONEY', message: 'Invalid current charge amount.' };
  }
  if (input.effectivePolicy === 'CURRENT_CYCLE_PRORATED' && !input.currentCycle) {
    return {
      success: false,
      error: 'CURRENT_CYCLE_REQUIRED',
      message: 'A cycle window is required for proration.',
    };
  }

  const ids = new Set<string>();
  const activeEnrollmentKinds = new Set<string>();
  for (const allocation of input.allocations) {
    if (ids.has(allocation.id)) {
      return {
        success: false,
        error: 'DUPLICATE_ALLOCATION_ID',
        message: 'Allocation ids must be unique.',
        allocationId: allocation.id,
      };
    }
    ids.add(allocation.id);
    if (!isMoneyCents(allocation.netAmountCents)) {
      return {
        success: false,
        error: 'INVALID_MONEY',
        message: 'Allocation amount must be non-negative integer cents.',
        allocationId: allocation.id,
      };
    }
    const startsAt = parseDate(allocation.validFrom);
    const endsAt = allocation.validUntil == null ? null : parseDate(allocation.validUntil);
    if (!startsAt || (allocation.validUntil != null && !endsAt) || (endsAt && endsAt <= startsAt)) {
      return {
        success: false,
        error: 'INVALID_ALLOCATION_VALIDITY',
        message: 'Allocation validity must be a non-empty semiopen interval.',
        allocationId: allocation.id,
      };
    }

    if (allocation.recurring && isEffectiveAt(allocation, effectiveAt)) {
      const enrollmentKind = `${allocation.matriculaId}:${allocation.kind}`;
      if (activeEnrollmentKinds.has(enrollmentKind)) {
        return {
          success: false,
          error: 'DUPLICATE_ACTIVE_ENROLLMENT_ALLOCATION',
          message: 'An enrollment cannot have two active allocations of the same kind.',
          allocationId: allocation.id,
        };
      }
      activeEnrollmentKinds.add(enrollmentKind);
    }
  }

  const activeAllocations = input.allocations.filter(
    (allocation) => allocation.recurring && isEffectiveAt(allocation, effectiveAt),
  );
  const desiredRecurringAmountCents = activeAllocations.reduce(
    (sum, allocation) => sum + allocation.netAmountCents,
    0,
  );
  if (!Number.isSafeInteger(desiredRecurringAmountCents)) {
    return { success: false, error: 'INVALID_MONEY', message: 'Agreement total is unsafe.' };
  }
  const aggregateValidity = calculateAggregateValidity(input.allocations, effectiveAt);

  let currentCycleTargetAmountCents = desiredRecurringAmountCents;
  if (input.effectivePolicy === 'NEXT_CYCLE' || input.effectivePolicy === 'MANUAL_ADJUSTMENT') {
    currentCycleTargetAmountCents =
      input.currentCharge?.amountCents ?? input.agreement?.confirmedAmountCents ?? 0;
  } else if (input.effectivePolicy === 'CURRENT_CYCLE_PRORATED') {
    currentCycleTargetAmountCents = 0;
    for (const allocation of input.allocations) {
      if (
        !allocation.recurring ||
        allocation.status === 'CANCELLED' ||
        allocation.status === 'PAUSED'
      ) {
        continue;
      }
      const prorated = prorateMoneyByDays({
        fullAmountCents: allocation.netAmountCents,
        cycle: input.currentCycle!,
        validFrom: allocation.validFrom,
        validUntil: allocation.validUntil,
      });
      if (!prorated.success) {
        return {
          success: false,
          error: prorated.error === 'INVALID_CYCLE' ? 'INVALID_CYCLE' : 'INVALID_DATE',
          message: 'Unable to prorate allocation.',
          allocationId: allocation.id,
        };
      }
      currentCycleTargetAmountCents += prorated.amountCents;
    }
  }

  const previousCurrentCycleAmountCents =
    input.currentCharge?.amountCents ?? input.agreement?.confirmedAmountCents ?? 0;
  const currentCycleDeltaCents =
    currentCycleTargetAmountCents - previousCurrentCycleAmountCents;
  const currentCycleEffect = decideCurrentCycleEffect({
    charge: input.currentCharge,
    deltaCents: currentCycleDeltaCents,
    policy: input.effectivePolicy,
    paidDecreaseHandling: input.paidDecreaseHandling ?? 'CREDIT',
  });

  return {
    success: true,
    value: {
      previousRecurringAmountCents: input.agreement?.desiredAmountCents ?? 0,
      desiredRecurringAmountCents,
      agreementValidFrom: aggregateValidity.validFrom,
      agreementValidUntil: aggregateValidity.validUntil,
      currentCycleTargetAmountCents,
      currentCycleDeltaCents,
      subscriptionAction: decideSubscriptionAction({
        agreement: input.agreement,
        desiredAmountCents: desiredRecurringAmountCents,
        isFutureEffective:
          input.effectivePolicy === 'NEXT_CYCLE' && effectiveAt.getTime() > calculatedAt.getTime(),
        hasPausedRecurringAllocation: input.allocations.some(
          (allocation) => allocation.recurring && allocation.status === 'PAUSED',
        ),
        agreementValidFrom: aggregateValidity.validFrom,
        agreementValidUntil: aggregateValidity.validUntil,
      }),
      ...currentCycleEffect,
      activeAllocationIds: activeAllocations.map(({ id }) => id).sort(),
    },
  };
}
