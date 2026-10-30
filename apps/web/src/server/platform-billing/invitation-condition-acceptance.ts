import { calculateCustomInvitationMonthlyAmountCents, resolveSchoolCommercialTarget } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import type { PlatformBillingPlanCode } from '@prisma/client';

type AcceptedInvitation = {
  id: string;
  currentConditionVersion: number;
  conditionType: 'STANDARD' | 'CUSTOM';
  studentCount: number | null;
  monthlyAmountCents: number | null;
  customBaseMonthlyAmountCents: number | null;
  customIncludedStudentCount: number | null;
  customMonthlyOverageAmountCents: number | null;
};

export type InvitationConditionSelection = {
  selectedPlanCode: PlatformBillingPlanCode | null;
  selectedMonthlyAmountCents: number | null;
};

/** Single source of truth for the exact band/amount accepted and later checked by billing routes. */
export function resolveInvitationConditionSelection(params: {
  invitation: AcceptedInvitation;
  selectedStudentCount: number;
}): { ok: true; selection: InvitationConditionSelection } | { ok: false; error: 'CUSTOM_CONDITION_COUNT_LOCKED' } {
  const { invitation, selectedStudentCount } = params;
  if (invitation.conditionType === 'CUSTOM') {
    if (selectedStudentCount !== invitation.studentCount) return { ok: false, error: 'CUSTOM_CONDITION_COUNT_LOCKED' };
    return {
      ok: true,
      selection: {
        selectedPlanCode: 'CUSTOM',
        selectedMonthlyAmountCents:
          invitation.customBaseMonthlyAmountCents != null &&
          invitation.customIncludedStudentCount != null &&
          invitation.customMonthlyOverageAmountCents != null
            ? calculateCustomInvitationMonthlyAmountCents({
              baseMonthlyAmountCents: invitation.customBaseMonthlyAmountCents,
              includedStudentCount: invitation.customIncludedStudentCount,
              monthlyPerStudentOverageCents: invitation.customMonthlyOverageAmountCents,
              studentCount: selectedStudentCount,
            })
            : invitation.monthlyAmountCents,
      },
    };
  }

  const target = resolveSchoolCommercialTarget(selectedStudentCount);
  return {
    ok: true,
    selection: target?.kind === 'SELF_SERVICE'
      ? { selectedPlanCode: target.band.code, selectedMonthlyAmountCents: target.band.amountCents }
      : { selectedPlanCode: null, selectedMonthlyAmountCents: null },
  };
}

/** Checks the customer's persisted approval against the latest terms and exact onboarding estimate. */
export async function hasAcceptedInvitationSelection(params: {
  tx: TenantTransactionClient;
  contaId: string;
  invitation: AcceptedInvitation;
  selectedStudentCount: number;
}): Promise<boolean> {
  const acceptance = await params.tx.platformSchoolInvitationConditionAcceptance.findFirst({
    where: {
      invitationId: params.invitation.id,
      version: params.invitation.currentConditionVersion,
      contaId: params.contaId,
      selectedStudentCount: params.selectedStudentCount,
    },
    orderBy: { acceptedAt: 'desc' },
    select: { selectedPlanCode: true, selectedMonthlyAmountCents: true },
  });
  if (!acceptance) return false;

  const resolved = resolveInvitationConditionSelection(params);
  return resolved.ok && acceptance.selectedPlanCode === resolved.selection.selectedPlanCode &&
    acceptance.selectedMonthlyAmountCents === resolved.selection.selectedMonthlyAmountCents;
}
