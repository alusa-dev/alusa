import { describe, expect, it } from 'vitest';
import { deriveInstallmentPlanLifecycleStatus } from './installment-plan-status.js';

describe('deriveInstallmentPlanLifecycleStatus', () => {
  it('preserves the current status when there are no charges', () => {
    expect(
      deriveInstallmentPlanLifecycleStatus({ currentStatus: 'ACTIVE', chargeStatuses: [] }),
    ).toBe('ACTIVE');
    expect(
      deriveInstallmentPlanLifecycleStatus({ currentStatus: 'COMPLETED', chargeStatuses: [] }),
    ).toBe('COMPLETED');
  });

  it('cancels a plan when every charge is canceled', () => {
    expect(
      deriveInstallmentPlanLifecycleStatus({
        currentStatus: 'ACTIVE',
        chargeStatuses: ['CANCELED', 'CANCELED', 'CANCELED'],
      }),
    ).toBe('CANCELED');
  });

  it('completes a plan when all charges are settled and at least one was paid', () => {
    expect(
      deriveInstallmentPlanLifecycleStatus({
        currentStatus: 'ACTIVE',
        chargeStatuses: ['PAID', 'CANCELED'],
      }),
    ).toBe('COMPLETED');
  });

  it('keeps an open plan active while a charge is open', () => {
    expect(
      deriveInstallmentPlanLifecycleStatus({
        currentStatus: 'COMPLETED',
        chargeStatuses: ['PAID', 'OPEN'],
      }),
    ).toBe('ACTIVE');
  });
});
