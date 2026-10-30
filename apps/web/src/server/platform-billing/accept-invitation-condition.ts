import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { resolveInvitationConditionSelection } from './invitation-condition-acceptance';

type Input = {
  tx: TenantTransactionClient;
  contaId: string;
  userId: string;
  version: number;
  selectedStudentCount: number;
};

type Result =
  | { kind: 'NOT_FOUND' }
  | { kind: 'VERSION_STALE'; currentVersion: number }
  | { kind: 'ESTIMATE_MISMATCH' }
  | { kind: 'CUSTOM_CONDITION_COUNT_LOCKED' }
  | {
    kind: 'ACCEPTED';
    alreadyAccepted: boolean;
    version: number;
    selectedStudentCount: number;
    selectedPlanCode: string | null;
    selectedMonthlyAmountCents: number | null;
  };

/** Persist an administrator's explicit acceptance against the current tenant invitation terms. */
export async function acceptInvitationCondition(input: Input): Promise<Result> {
  const { tx, contaId, userId, version, selectedStudentCount } = input;

  // Keep support revisions serialized with acceptance and subsequent billing actions.
  await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PlatformSchoolInvitation" WHERE "acceptedContaId" = ${contaId} AND "status" = 'ACCEPTED' FOR UPDATE`;
  const invitation = await tx.platformSchoolInvitation.findFirst({
    where: { acceptedContaId: contaId, status: 'ACCEPTED' },
    select: {
      id: true,
      currentConditionVersion: true,
      conditionType: true,
      studentCount: true,
      planCode: true,
      monthlyAmountCents: true,
      customBaseMonthlyAmountCents: true,
      customIncludedStudentCount: true,
      customMonthlyOverageAmountCents: true,
    },
  });
  if (!invitation) return { kind: 'NOT_FOUND' };
  if (version !== invitation.currentConditionVersion) return { kind: 'VERSION_STALE', currentVersion: invitation.currentConditionVersion };

  const financeProfile = await tx.financeProfile.findUnique({ where: { contaId }, select: { onboardingStudentCount: true, wizardCompletedAt: true } });
  if (!financeProfile?.wizardCompletedAt || financeProfile.onboardingStudentCount !== selectedStudentCount) return { kind: 'ESTIMATE_MISMATCH' };

  const resolved = resolveInvitationConditionSelection({ invitation, selectedStudentCount });
  if (!resolved.ok) return { kind: resolved.error };
  const { selectedPlanCode, selectedMonthlyAmountCents } = resolved.selection;
  const saved = await tx.platformSchoolInvitationConditionAcceptance.createMany({
    data: [{ invitationId: invitation.id, version: invitation.currentConditionVersion, contaId, acceptedBy: userId, selectedStudentCount, selectedPlanCode, selectedMonthlyAmountCents }],
    skipDuplicates: true,
  });
  if (saved.count === 1) {
    await tx.platformSchoolInvitationHistory.create({
      data: {
        invitationId: invitation.id,
        actorId: userId,
        action: 'CONDITION_ACCEPTED',
        after: { version: invitation.currentConditionVersion, contaId, selectedStudentCount, selectedPlanCode, selectedMonthlyAmountCents },
      },
    });
  }

  return {
    kind: 'ACCEPTED',
    alreadyAccepted: saved.count === 0,
    version: invitation.currentConditionVersion,
    selectedStudentCount,
    selectedPlanCode,
    selectedMonthlyAmountCents,
  };
}
