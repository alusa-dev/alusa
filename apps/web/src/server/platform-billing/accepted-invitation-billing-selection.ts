import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { resolveInvitationConditionSelection, hasAcceptedInvitationSelection } from './invitation-condition-acceptance';

type OnboardingPricing = {
  wizardCompletedAt: Date | null;
  onboardingStudentCount: number | null;
};

/** Resolves one tenant's accepted invitation terms for both trial and paid Checkout. */
export async function resolveAcceptedInvitationBillingSelection(params: {
  tx: TenantTransactionClient;
  contaId: string;
  fallbackStudentCount: number;
  onboardingPricing?: OnboardingPricing | null;
}) {
  const { tx, contaId, fallbackStudentCount } = params;
  const invitation = await tx.platformSchoolInvitation.findFirst({
    where: { acceptedContaId: contaId, status: 'ACCEPTED' },
    select: {
      id: true,
      currentConditionVersion: true,
      conditionType: true,
      studentCount: true,
      monthlyAmountCents: true,
      customBaseMonthlyAmountCents: true,
      customIncludedStudentCount: true,
      customMonthlyOverageAmountCents: true,
      trialDays: true,
      stripePriceId: true,
      stripeProductId: true,
    },
  });

  if (!invitation) return { kind: 'NONE' as const, selectedStudentCount: fallbackStudentCount };

  const onboardingPricing = params.onboardingPricing === undefined
    ? await tx.financeProfile.findUnique({
      where: { contaId },
      select: { wizardCompletedAt: true, onboardingStudentCount: true },
    })
    : params.onboardingPricing;

  const selectedStudentCount = onboardingPricing?.wizardCompletedAt && onboardingPricing.onboardingStudentCount !== null
    ? onboardingPricing.onboardingStudentCount
    : fallbackStudentCount;
  const condition = resolveInvitationConditionSelection({ invitation, selectedStudentCount });
  const accepted = condition.ok && await hasAcceptedInvitationSelection({
    tx,
    contaId,
    invitation,
    selectedStudentCount,
  });

  if (!accepted || !condition.ok) {
    return {
      kind: 'ACCEPTANCE_REQUIRED' as const,
      currentVersion: invitation.currentConditionVersion,
      selectedStudentCount,
    };
  }

  return {
    kind: 'ACCEPTED' as const,
    invitation,
    selectedStudentCount,
    selectedPlanCode: condition.selection.selectedPlanCode,
    selectedMonthlyAmountCents: condition.selection.selectedMonthlyAmountCents,
  };
}
