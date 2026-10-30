import {
  isSchoolPriceBandCode,
  resolveSchoolCommercialTarget,
  resolveStableSchoolPriceBand,
} from './commercial-model';
import { isPublicPlatformPlanCode } from './plans';
import type { PlatformPlanCode } from './plans';
import type { SchoolPriceBandCode } from './commercial-model';

export type PlatformBillingCheckoutCommercialContext = {
  activeStudents: number;
  billingPlanCode: string | null;
  billingStatus: string | null;
  billingAccessStatus: string | null;
  onboardingPricing: { wizardCompletedAt: Date | null; onboardingStudentCount: number | null } | null;
  recentSnapshots: Array<{ periodStart: Date; candidateBand: SchoolPriceBandCode | 'SPECIALIST' | null }>;
  acceptedInvitation?: { conditionType: string; stripePriceId: string | null; studentCount: number | null } | null;
};

export type ResolvePlatformBillingCheckoutPlanResult =
  | { kind: 'RESOLVED'; planCode: PlatformPlanCode; currentBand: string | null; studentCount: number; stripePriceId?: string }
  | { kind: 'SPECIALIST'; reason: 'CONFIRMED_SPECIALIST' | 'COUNT_ABOVE_SELF_SERVICE'; studentCount?: number }
  | { kind: 'UNSTABLE' };

/** Resolves the current self-service plan from persisted commercial state. */
export async function resolvePlatformBillingCheckoutPlan(
  deps: { loadContext: () => Promise<PlatformBillingCheckoutCommercialContext> },
): Promise<ResolvePlatformBillingCheckoutPlanResult> {
  const context = await deps.loadContext();
  if (context.acceptedInvitation?.conditionType === 'CUSTOM') {
    const declaredCount = context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount
      ? context.onboardingPricing.onboardingStudentCount
      : context.acceptedInvitation.studentCount ?? 0;
    const studentCount = context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount !== null
      ? declaredCount
      : context.activeStudents > 0 ? context.activeStudents : declaredCount;
    if (!context.acceptedInvitation.stripePriceId) return { kind: 'UNSTABLE' };
    return { kind: 'RESOLVED', planCode: 'CUSTOM', currentBand: null, studentCount, stripePriceId: context.acceptedInvitation.stripePriceId };
  }
  const declaredStudentCount = context.onboardingPricing?.wizardCompletedAt &&
    context.onboardingPricing.onboardingStudentCount
    ? context.onboardingPricing.onboardingStudentCount
    : null;
  const currentBand = isSchoolPriceBandCode(context.billingPlanCode) ? context.billingPlanCode : null;
  const stableTarget = resolveStableSchoolPriceBand({
    currentBand,
    snapshots: context.recentSnapshots,
  });
  if (stableTarget === 'SPECIALIST') return { kind: 'SPECIALIST', reason: 'CONFIRMED_SPECIALIST' };

  const isTerminallyCanceled = context.billingStatus === 'CANCELED' && context.billingAccessStatus === 'CANCELED';
  if (context.billingPlanCode && !isPublicPlatformPlanCode(context.billingPlanCode) && !isTerminallyCanceled) {
    return { kind: 'UNSTABLE' };
  }

  // A confirmed band remains in force until monthly snapshots formally
  // establish a transition. Live enrollment counts do not reprice it.
  if (currentBand) return { kind: 'RESOLVED', planCode: currentBand, currentBand, studentCount: context.activeStudents };

  // Existing effective enrollment data wins. Before the school has students,
  // use only the completed and persisted onboarding declaration.
  const studentCount = context.acceptedInvitation && context.onboardingPricing?.wizardCompletedAt && context.onboardingPricing.onboardingStudentCount !== null
    ? declaredStudentCount ?? 0
    : context.activeStudents > 0 ? context.activeStudents : declaredStudentCount ?? 0;
  const target = resolveSchoolCommercialTarget(studentCount);
  if (!target || target.kind === 'SPECIALIST') {
    return { kind: 'SPECIALIST', reason: 'COUNT_ABOVE_SELF_SERVICE', studentCount };
  }
  return { kind: 'RESOLVED', planCode: target.band.code, currentBand, studentCount };
}
