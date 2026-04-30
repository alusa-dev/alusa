import { prisma } from '@alusa/database';
import type { FinanceStatus, FinancialOnboardingStatus } from '@prisma/client';

import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { reconcileAsaasAccount } from './asaas-account/reconcile-asaas-account';

export type OnboardingStatusResult = {
  status: FinancialOnboardingStatus;
  hasSubaccount: boolean;
  hasAsaasAccountRecord: boolean;
  financeProfileId: string | null;
  financeStatus: FinanceStatus;
  financeProfile: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    isOnboardingCompleted: boolean;
    onboardingCompletedAt: Date | null;
    lastAsaasSyncAt: Date | null;
  } | null;
};

export async function getOnboardingStatus(contaId: string): Promise<OnboardingStatusResult> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { financeStatus: true },
  });
  if (!conta) {
    throw new Error('Conta não encontrada');
  }

  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });
  if (!profile) {
    return {
      financeProfileId: null,
      status: 'NOT_STARTED',
      hasSubaccount: false,
      hasAsaasAccountRecord: false,
      financeStatus: conta.financeStatus,
      financeProfile: null,
    };
  }

  const financeProfileState = await prisma.financeProfile.findUnique({
    where: { id: profile.id },
    select: {
      status: true,
      isOnboardingCompleted: true,
      onboardingCompletedAt: true,
      lastAsaasSyncAt: true,
    },
  });

  const account = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: { status: true, asaasAccountId: true, statusUpdatedAt: true },
  });

  const shouldReconcile = (() => {
    if (!account?.asaasAccountId) return false;
    if (account.status === 'IN_PROGRESS') return true;

    // Evitar bater no Asaas a cada refresh quando já está em estados pós-criação.
    if (account.status === ('CREATED' as FinancialOnboardingStatus) || account.status === 'UNDER_REVIEW') {
      const ageMs = Date.now() - account.statusUpdatedAt.getTime();
      return ageMs > 10 * 60 * 1000;
    }

    return false;
  })();

  if (shouldReconcile) {
    try {
      const reconciled = await reconcileAsaasAccount({
        contaId,
        reason: `getOnboardingStatus:${account?.status}`,
      });

      const refreshedFinanceProfileState = await prisma.financeProfile.findUnique({
        where: { id: profile.id },
        select: {
          status: true,
          isOnboardingCompleted: true,
          onboardingCompletedAt: true,
          lastAsaasSyncAt: true,
        },
      });

      return {
        financeProfileId: profile.id,
        status: reconciled.updatedStatus,
        hasSubaccount: Boolean(account?.asaasAccountId),
        hasAsaasAccountRecord: true,
        financeStatus: reconciled.updatedFinanceStatus,
        financeProfile: refreshedFinanceProfileState
          ? {
              status: refreshedFinanceProfileState.status,
              isOnboardingCompleted: refreshedFinanceProfileState.isOnboardingCompleted,
              onboardingCompletedAt: refreshedFinanceProfileState.onboardingCompletedAt,
              lastAsaasSyncAt: refreshedFinanceProfileState.lastAsaasSyncAt,
            }
          : null,
      };
    } catch (error) {
      const failure = classifyAsaasOperationalError(error, 'subaccount');

      console.warn('[Finance Onboarding] Falha ao reconciliar status com Asaas', {
        category: failure.category,
        status: failure.status,
        contaId,
        financeProfileId: profile.id,
        asaasAccountId: account?.asaasAccountId,
        error: failure.message,
        retryable: failure.retryable,
        details: failure.details,
      });
    }
  }

  return {
    financeProfileId: profile.id,
    status: account?.status ?? 'NOT_STARTED',
    hasSubaccount: Boolean(account?.asaasAccountId),
    hasAsaasAccountRecord: Boolean(account),
    financeStatus: conta.financeStatus,
    financeProfile: financeProfileState
      ? {
          status: financeProfileState.status,
          isOnboardingCompleted: financeProfileState.isOnboardingCompleted,
          onboardingCompletedAt: financeProfileState.onboardingCompletedAt,
          lastAsaasSyncAt: financeProfileState.lastAsaasSyncAt,
        }
      : null,
  };
}
