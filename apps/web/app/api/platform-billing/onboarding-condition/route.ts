import { NextResponse } from 'next/server';
import { withTenantSession } from '@/lib/api/with-tenant-session';

export async function GET() {
  return withTenantSession(async ({ contaId, tx }) => {
    const invitation = await tx.platformSchoolInvitation.findFirst({
      where: { acceptedContaId: contaId, status: 'ACCEPTED' },
      select: {
        id: true, currentConditionVersion: true,
      },
    });
    if (!invitation) return NextResponse.json({ data: null }, { headers: { 'cache-control': 'no-store' } });
    const [conditionVersion, financeProfile] = await Promise.all([
      tx.platformSchoolInvitationConditionVersion.findUnique({ where: { invitationId_version: { invitationId: invitation.id, version: invitation.currentConditionVersion } } }),
      tx.financeProfile.findUnique({ where: { contaId }, select: { onboardingStudentCount: true } }),
    ]);
    const accepted = financeProfile?.onboardingStudentCount === null || financeProfile?.onboardingStudentCount === undefined
      ? null
      : await tx.platformSchoolInvitationConditionAcceptance.findFirst({
        where: { invitationId: invitation.id, version: invitation.currentConditionVersion, contaId, selectedStudentCount: financeProfile.onboardingStudentCount },
        orderBy: { acceptedAt: 'desc' },
        select: { selectedStudentCount: true, selectedPlanCode: true, selectedMonthlyAmountCents: true },
      });
    const snapshot = conditionVersion?.snapshot as { conditionType: 'STANDARD' | 'CUSTOM'; planCode: string | null; studentCount: number | null; monthlyAmountCents: number | null; customBaseMonthlyAmountCents?: number | null; customIncludedStudentCount?: number | null; customMonthlyOverageAmountCents?: number | null; stripePriceId?: string | null; stripeProductId?: string | null; trialDays: number } | undefined;
    return NextResponse.json({ data: snapshot ? { ...snapshot, currentConditionVersion: invitation.currentConditionVersion, acceptedCurrentVersion: Boolean(accepted), acceptedStudentCount: accepted?.selectedStudentCount ?? null, acceptedPlanCode: accepted?.selectedPlanCode ?? null, acceptedMonthlyAmountCents: accepted?.selectedMonthlyAmountCents ?? null } : null }, { headers: { 'cache-control': 'no-store' } });
  });
}
