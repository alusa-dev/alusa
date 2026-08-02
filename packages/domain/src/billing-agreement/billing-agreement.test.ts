import { describe, expect, it } from 'vitest';
import {
  calculateBillingAgreementDesiredState,
  distributeMoneyByWeight,
  prorateMoneyByDays,
  type BillingAgreementAllocationInput,
} from './index.js';

const cycle = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-02-01T00:00:00.000Z' };

function allocation(
  overrides: Partial<BillingAgreementAllocationInput> = {},
): BillingAgreementAllocationInput {
  return {
    id: 'allocation-1',
    matriculaId: 'enrollment-1',
    alunoId: 'student-1',
    kind: 'TUITION',
    status: 'ACTIVE',
    recurring: true,
    netAmountCents: 10_000,
    validFrom: cycle.startsAt,
    ...overrides,
  };
}

describe('billing agreement money', () => {
  it('conserves cents and resolves equal remainders by stable id', () => {
    const result = distributeMoneyByWeight(100, [
      { id: 'b', weight: 1 },
      { id: 'a', weight: 1 },
      { id: 'c', weight: 1 },
    ]);

    expect(result).toEqual({ success: true, allocations: { b: 33, a: 34, c: 33 } });
    if (result.success) {
      expect(Object.values(result.allocations).reduce((sum, value) => sum + value, 0)).toBe(100);
    }
  });

  it('keeps product-price proportions', () => {
    expect(
      distributeMoneyByWeight(24_000, [
        { id: 'cheap', weight: 10_000 },
        { id: 'expensive', weight: 20_000 },
      ]),
    ).toEqual({ success: true, allocations: { cheap: 8_000, expensive: 16_000 } });
  });
});

describe('billing agreement proration', () => {
  it('uses semiopen civil-day windows without DST drift', () => {
    expect(
      prorateMoneyByDays({
        fullAmountCents: 3_100,
        cycle,
        validFrom: '2026-01-16T15:00:00-04:00',
      }),
    ).toEqual({ success: true, amountCents: 1_600, activeDays: 16, cycleDays: 31 });
  });

  it('rounds half cents deterministically', () => {
    expect(
      prorateMoneyByDays({
        fullAmountCents: 100,
        cycle: { startsAt: '2026-01-01', endsAt: '2026-01-09' },
        validFrom: '2026-01-02',
        validUntil: '2026-01-06',
      }),
    ).toEqual({ success: true, amountCents: 50, activeDays: 4, cycleDays: 8 });
  });
});

describe('calculateBillingAgreementDesiredState', () => {
  it('updates a provisioned subscription and its pending charge', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [
        allocation(),
        allocation({
          id: 'allocation-2',
          matriculaId: 'enrollment-2',
          alunoId: 'student-2',
          netAmountCents: 5_000,
        }),
      ],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        desiredRecurringAmountCents: 15_000,
        agreementValidFrom: '2026-01-01T00:00:00.000Z',
        subscriptionAction: 'UPDATE',
        updatePendingPayments: true,
        adjustment: { type: 'NONE' },
      },
    });
  });

  it('creates a complement instead of mutating a paid charge', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ netAmountCents: 12_500 })],
      currentCharge: { state: 'PAID', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        subscriptionAction: 'UPDATE',
        updatePendingPayments: false,
        adjustment: { type: 'COMPLEMENT', amountCents: 2_500 },
      },
    });
  });

  it.each([
    ['CREDIT', 'CREDIT'],
    ['REFUND', 'REFUND'],
    ['MANUAL_REVIEW', 'MANUAL_REVIEW'],
  ] as const)('handles a paid decrease as %s', (paidDecreaseHandling, expected) => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      paidDecreaseHandling,
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ netAmountCents: 7_500 })],
      currentCharge: { state: 'PAID', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: { adjustment: { type: expected, amountCents: 2_500 } },
    });
  });

  it('schedules next-cycle mutation and leaves the current charge untouched', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-02-01',
      effectivePolicy: 'NEXT_CYCLE',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ netAmountCents: 7_500, validFrom: '2026-02-01' })],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        desiredRecurringAmountCents: 7_500,
        currentCycleTargetAmountCents: 10_000,
        currentCycleDeltaCents: 0,
        subscriptionAction: 'SCHEDULE_UPDATE',
        updatePendingPayments: false,
      },
    });
  });

  it('cancels only when no recurring allocations remain', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ status: 'ENDED', validUntil: '2026-01-10' })],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        desiredRecurringAmountCents: 0,
        agreementValidFrom: null,
        agreementValidUntil: null,
        subscriptionAction: 'CANCEL',
      },
    });
  });

  it('pauses instead of deleting the agreement when its last allocation is paused', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ status: 'PAUSED' })],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: { desiredRecurringAmountCents: 0, subscriptionAction: 'PAUSE' },
    });
  });

  it('resumes an inactive agreement when an allocation becomes active again', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'INACTIVE',
        desiredAmountCents: 0,
        confirmedAmountCents: 0,
        version: 3,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation()],
      currentCharge: { state: 'NOT_GENERATED', amountCents: 0 },
    });

    expect(result).toMatchObject({
      success: true,
      value: { desiredRecurringAmountCents: 10_000, subscriptionAction: 'RESUME' },
    });
  });

  it('allows several enrollments for the same student', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: null,
      allocations: [
        allocation(),
        allocation({ id: 'allocation-2', matriculaId: 'enrollment-2' }),
      ],
    });

    expect(result).toMatchObject({
      success: true,
      value: { desiredRecurringAmountCents: 20_000, subscriptionAction: 'CREATE' },
    });
  });

  it('rejects duplicate active allocation versions for one enrollment and kind', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: null,
      allocations: [allocation(), allocation({ id: 'allocation-2' })],
    });

    expect(result).toMatchObject({
      success: false,
      error: 'DUPLICATE_ACTIVE_ENROLLMENT_ALLOCATION',
    });
  });

  it('calculates the current-cycle prorated target', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-16',
      effectiveAt: '2026-01-16',
      effectivePolicy: 'CURRENT_CYCLE_PRORATED',
      agreement: null,
      allocations: [allocation({ netAmountCents: 3_100, validFrom: '2026-01-16' })],
      currentCycle: cycle,
      currentCharge: { state: 'NOT_GENERATED', amountCents: 0 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        desiredRecurringAmountCents: 3_100,
        currentCycleTargetAmountCents: 1_600,
      },
    });
  });

  it('uses the latest allocation end as the exclusive agreement end', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [
        allocation({ validUntil: '2026-02-01' }),
        allocation({
          id: 'allocation-2',
          matriculaId: 'enrollment-2',
          validFrom: '2026-01-15',
          validUntil: '2026-07-01',
        }),
      ],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        agreementValidFrom: '2026-01-01T00:00:00.000Z',
        agreementValidUntil: '2026-07-01T00:00:00.000Z',
      },
    });
  });

  it('keeps aggregate validity open when any recurring allocation has no end', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: null,
      allocations: [
        allocation({ validUntil: '2026-02-01' }),
        allocation({
          id: 'allocation-2',
          matriculaId: 'enrollment-2',
          validFrom: '2026-01-15',
          validUntil: null,
        }),
      ],
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        agreementValidFrom: '2026-01-01T00:00:00.000Z',
        agreementValidUntil: null,
      },
    });
  });

  it('updates the remote subscription when only aggregate validity changes', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE', desiredAmountCents: 10_000, confirmedAmountCents: 10_000,
        version: 2, remoteSubscriptionExists: true,
        validFrom: '2026-01-01', validUntil: '2026-12-01',
      },
      allocations: [allocation({ validUntil: '2026-07-01' })],
      currentCharge: { state: 'PENDING', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: { subscriptionAction: 'UPDATE', agreementValidUntil: '2026-07-01T00:00:00.000Z' },
    });
  });

  it('does not let a short enrollment shrink a longer shared agreement', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-30',
      effectiveAt: '2026-01-30',
      effectivePolicy: 'CURRENT_CYCLE_PRORATED',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 15_000,
        confirmedAmountCents: 15_000,
        version: 4,
        remoteSubscriptionExists: true,
      },
      allocations: [
        allocation({
          netAmountCents: 15_000,
          validUntil: '2026-12-01',
        }),
        allocation({
          id: 'short-allocation',
          matriculaId: 'short-enrollment',
          alunoId: 'short-student',
          netAmountCents: 6_200,
          validFrom: '2026-01-30',
          validUntil: '2026-02-05',
        }),
      ],
      currentCycle: cycle,
      currentCharge: { state: 'PAID', amountCents: 15_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        desiredRecurringAmountCents: 21_200,
        currentCycleTargetAmountCents: 15_400,
        currentCycleDeltaCents: 400,
        agreementValidUntil: '2026-12-01T00:00:00.000Z',
        updatePendingPayments: false,
        adjustment: { type: 'COMPLEMENT', amountCents: 400 },
      },
    });
  });

  it('requires manual review for an overdue current-cycle difference', () => {
    const result = calculateBillingAgreementDesiredState({
      calculatedAt: '2026-01-10',
      effectiveAt: '2026-01-10',
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      agreement: {
        status: 'ACTIVE',
        desiredAmountCents: 10_000,
        confirmedAmountCents: 10_000,
        version: 2,
        remoteSubscriptionExists: true,
      },
      allocations: [allocation({ netAmountCents: 12_500 })],
      currentCharge: { state: 'OVERDUE', amountCents: 10_000 },
    });

    expect(result).toMatchObject({
      success: true,
      value: {
        updatePendingPayments: false,
        adjustment: {
          type: 'MANUAL_REVIEW',
          amountCents: 2_500,
          reason: 'OVERDUE_CHARGE_REQUIRES_REVIEW',
        },
      },
    });
  });
});
