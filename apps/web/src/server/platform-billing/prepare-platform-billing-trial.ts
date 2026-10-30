import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { countActivePlatformBillingStudents } from './platform-billing-server';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing';
import { resolveAcceptedInvitationBillingSelection } from './accepted-invitation-billing-selection';

type TrialEligibility =
  | {
      ok: true;
      planCode: string;
      stripePriceId?: string;
      invitationId?: string;
      quantity?: number;
      trialDays: number;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

/** Resolve tenant readiness and the accepted commercial selection before trial creation. */
export async function preparePlatformBillingTrial(params: {
  tx: TenantTransactionClient;
  contaId: string;
}): Promise<TrialEligibility> {
  const { tx, contaId } = params;

  // Serialize invitation revisions against trial creation in the same tenant transaction.
  await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PlatformSchoolInvitation" WHERE "acceptedContaId" = ${contaId} AND "status" = 'ACCEPTED' FOR UPDATE`;

  const conta = await tx.conta.findFirst({
    where: { id: contaId, status: 'ATIVO', deletedAt: null },
    select: { financeIntegrationMode: true },
  });
  if (!conta) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'INITIAL_SETUP_REQUIRED',
        message: 'A conta precisa estar ativa antes de iniciar o período de teste.',
      },
    };
  }

  const [activeStudents, financeProfile] = await Promise.all([
    countActivePlatformBillingStudents({ tx, contaId }),
    tx.financeProfile.findUnique({
      where: { contaId },
      select: {
        wizardCompletedAt: true,
        onboardingStudentCount: true,
        asaasAccount: {
          select: {
            asaasAccountId: true,
            apiKeyEncrypted: true,
            apiKeyStatus: true,
          },
        },
      },
    }),
  ]);
  const connectedAsaasAccount = Boolean(
    financeProfile?.asaasAccount?.asaasAccountId
    && financeProfile.asaasAccount.apiKeyEncrypted
    && financeProfile.asaasAccount.apiKeyStatus === 'CONNECTED',
  );
  if (!financeProfile?.wizardCompletedAt || !connectedAsaasAccount) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'FINANCE_ONBOARDING_PENDING',
        message: 'Conclua o wizard e conecte uma conta Asaas válida antes de iniciar o teste grátis.',
        financeIntegrationMode: conta.financeIntegrationMode,
      },
    };
  }

  // An invitation's estimate is adjustable in onboarding and is the initial billing quantity.
  const fallbackStudentCount = activeStudents > 0
    ? activeStudents
    : financeProfile.onboardingStudentCount ?? activeStudents;
  const invitationSelection = await resolveAcceptedInvitationBillingSelection({
    tx,
    contaId,
    fallbackStudentCount,
    onboardingPricing: financeProfile,
  });
  const studentCount = invitationSelection.selectedStudentCount;

  if (invitationSelection.kind === 'ACCEPTANCE_REQUIRED') {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'INVITATION_CONDITION_ACCEPTANCE_REQUIRED',
        currentVersion: invitationSelection.currentVersion,
        selectedStudentCount: studentCount,
      },
    };
  }

  const invitation = invitationSelection.kind === 'ACCEPTED' ? invitationSelection.invitation : null;

  if (invitation?.trialDays === 0) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'CHECKOUT_REQUIRED',
        message: 'A configuração foi concluída. Continue para confirmar a contratação.',
      },
    };
  }

  const customInvitation = invitation?.conditionType === 'CUSTOM' && invitation.stripePriceId
    ? invitation
    : null;
  const commercialTarget = customInvitation ? null : resolveSchoolCommercialTarget(studentCount);
  const standardPlanCode = invitationSelection.kind === 'ACCEPTED'
    ? invitationSelection.selectedPlanCode
    : commercialTarget?.kind === 'SELF_SERVICE' ? commercialTarget.band.code : null;
  if (!customInvitation && (!standardPlanCode || commercialTarget?.kind !== 'SELF_SERVICE')) {
    return {
      ok: false,
      status: 422,
      body: {
        error: 'SPECIALIST_REQUIRED',
        message: 'Escolas com mais de 500 alunos precisam conversar com um especialista.',
        activeStudents: studentCount,
      },
    };
  }

  return {
    ok: true,
    planCode: customInvitation ? 'CUSTOM' : standardPlanCode!,
    stripePriceId: customInvitation?.stripePriceId ?? undefined,
    invitationId: customInvitation?.id,
    quantity: customInvitation?.stripeProductId ? studentCount : undefined,
    trialDays: invitation?.trialDays ?? 14,
  };
}
