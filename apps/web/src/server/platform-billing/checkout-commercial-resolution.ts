import { resolvePlatformBillingCheckoutPlan } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { countActivePlatformBillingStudents } from './platform-billing-server';

export function resolveTenantPlatformBillingCheckoutPlan(input: {
  tx: TenantTransactionClient;
  contaId: string;
  environment: 'TEST' | 'LIVE';
}) {
  const { tx, contaId, environment } = input;
  return resolvePlatformBillingCheckoutPlan({
    loadContext: async () => {
      const [activeStudents, billingAccount, onboardingPricing, recentSnapshots] = await Promise.all([
        countActivePlatformBillingStudents({ tx, contaId }),
        tx.platformBillingAccount.findUnique({
          where: { uq_platform_billing_account_conta_env: { contaId, environment } },
          select: { planCode: true, status: true, accessStatus: true },
        }),
        tx.financeProfile.findUnique({
          where: { contaId },
          select: { wizardCompletedAt: true, onboardingStudentCount: true },
        }),
        tx.platformBillingMonthlySnapshot.findMany({
          where: { contaId, environment },
          orderBy: { periodStart: 'desc' },
          take: 3,
          select: { periodStart: true, candidateBand: true },
        }),
      ]);
      return {
        activeStudents,
        billingPlanCode: billingAccount?.planCode ?? null,
        billingStatus: billingAccount?.status ?? null,
        billingAccessStatus: billingAccount?.accessStatus ?? null,
        onboardingPricing,
        recentSnapshots,
      };
    },
  });
}
