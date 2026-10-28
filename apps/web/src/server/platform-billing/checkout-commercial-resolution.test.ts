import { describe, expect, it, vi } from 'vitest';

const { countActiveStudents } = vi.hoisted(() => ({ countActiveStudents: vi.fn(async () => 88) }));

vi.mock('./platform-billing-server', () => ({ countActivePlatformBillingStudents: countActiveStudents }));

import { resolveTenantPlatformBillingCheckoutPlan } from './checkout-commercial-resolution';

describe('resolveTenantPlatformBillingCheckoutPlan', () => {
  it('scopes all reads to the supplied tenant and environment and forwards canceled billing state', async () => {
    const tx = {
      platformBillingAccount: { findUnique: vi.fn(async () => ({
        planCode: 'PREMIUM', status: 'CANCELED', accessStatus: 'CANCELED',
      })) },
      financeProfile: { findUnique: vi.fn(async () => null) },
      platformBillingMonthlySnapshot: { findMany: vi.fn(async () => []) },
    };

    const result = await resolveTenantPlatformBillingCheckoutPlan({
      tx: tx as never,
      contaId: 'conta_a',
      environment: 'TEST',
    });

    expect(result).toMatchObject({ kind: 'RESOLVED', planCode: 'BAND_051_100', studentCount: 88 });
    expect(countActiveStudents).toHaveBeenCalledWith({ tx, contaId: 'conta_a' });
    expect(tx.platformBillingAccount.findUnique).toHaveBeenCalledWith({
      where: { uq_platform_billing_account_conta_env: { contaId: 'conta_a', environment: 'TEST' } },
      select: { planCode: true, status: true, accessStatus: true },
    });
    expect(tx.financeProfile.findUnique).toHaveBeenCalledWith({
      where: { contaId: 'conta_a' },
      select: { wizardCompletedAt: true, onboardingStudentCount: true },
    });
    expect(tx.platformBillingMonthlySnapshot.findMany).toHaveBeenCalledWith({
      where: { contaId: 'conta_a', environment: 'TEST' },
      orderBy: { periodStart: 'desc' },
      take: 3,
      select: { periodStart: true, candidateBand: true },
    });
  });
});
