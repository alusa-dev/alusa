import { getMyAccountStatus, getSubaccount, type AsaasMyAccountStatus } from '@alusa/asaas';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { AuditActorType, FinanceStatus, FinancialOnboardingStatus } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { classifyAsaasOperationalError } from '../../foundation/asaas-operational-error';
import { financeProfileService } from '../../foundation/finance-profile.service';
import { resolveCommercialInfoState } from '../kyc/kyc-cache-utils';
import { getMasterAsaasApiKey } from './asaas-env';
import { ensureSubaccountEmailSynced } from './ensure-subaccount-email-synced';

type ReconcileResult = {
  financeProfileId: string;
  asaasAccountId: string;
  previousStatus: FinancialOnboardingStatus;
  updatedStatus: FinancialOnboardingStatus;
  previousFinanceStatus: FinanceStatus;
  updatedFinanceStatus: FinanceStatus;
  previousCommercialInfoStatus: string | null;
  updatedCommercialInfoStatus: string | null;
  updatedCommercialInfoScheduledDate: string | null;
  reconciled: boolean;
  myAccountStatus: AsaasMyAccountStatus | null;
};

function mapMyAccountStatusToInternal(
  myAccountStatus: AsaasMyAccountStatus,
): { onboardingStatus: FinancialOnboardingStatus; financeStatus: FinanceStatus } {
  const general = myAccountStatus.general;

  if (general === 'APPROVED') {
    return { onboardingStatus: 'APPROVED', financeStatus: 'FINANCE_APPROVED' };
  }

  if (general === 'REJECTED') {
    return { onboardingStatus: 'REJECTED', financeStatus: 'FINANCE_REJECTED' };
  }

  // Mantém simples: se existe subconta mas não há aprovação geral, consideramos em análise.
  return { onboardingStatus: 'UNDER_REVIEW', financeStatus: 'FINANCE_PROFILE_COMPLETED' };
}

export async function reconcileAsaasAccount(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
  reason?: string;
}): Promise<ReconcileResult> {
  const conta = await prisma.conta.findUnique({ where: { id: params.contaId }, select: { financeStatus: true } });
  if (!conta) {
    throw new Error('Conta não encontrada');
  }

  const profile = await prisma.financeProfile.findUnique({ where: { contaId: params.contaId }, select: { id: true } });
  if (!profile) {
    throw new Error('FinanceProfile não encontrado');
  }

  const asaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: {
      id: true,
      status: true,
      asaasAccountId: true,
      commercialInfoStatus: true,
      commercialInfoScheduledDate: true,
    },
  });

  if (!asaasAccount?.asaasAccountId) {
    return {
      financeProfileId: profile.id,
      asaasAccountId: asaasAccount?.asaasAccountId ?? '',
      previousStatus: asaasAccount?.status ?? 'NOT_STARTED',
      updatedStatus: asaasAccount?.status ?? 'NOT_STARTED',
      previousFinanceStatus: conta.financeStatus,
      updatedFinanceStatus: conta.financeStatus,
      previousCommercialInfoStatus: asaasAccount?.commercialInfoStatus ?? null,
      updatedCommercialInfoStatus: asaasAccount?.commercialInfoStatus ?? null,
      updatedCommercialInfoScheduledDate: asaasAccount?.commercialInfoScheduledDate ?? null,
      reconciled: false,
      myAccountStatus: null,
    };
  }

  const creds = await loadAsaasCredentials(params.contaId);

  // 1) Fonte de verdade mínima: com credencial da subconta, /myAccount/status
  // prova que a chave ainda opera. Sem credencial, caímos no lookup via master.
  if (!creds?.apiKey) {
    try {
      await getSubaccount({
        apiKey: getMasterAsaasApiKey(),
        accountId: asaasAccount.asaasAccountId,
      });
    } catch (error) {
      const failure = classifyAsaasOperationalError(error, 'master');

      try {
        console.warn('[finance.reconcileAsaasAccount] Falha ao consultar subconta no Asaas', {
          category: failure.category,
          status: failure.status,
          contaId: params.contaId,
          financeProfileId: profile.id,
          asaasAccountId: asaasAccount.asaasAccountId,
          reason: params.reason,
          error: failure.message,
          retryable: failure.retryable,
          details: failure.details,
        });
      } catch {
        // noop
      }

      throw error;
    }
  }

  // 2) Quando temos credenciais da subconta, usamos /myAccount/status para saber se está aprovado.
  if (creds?.apiKey) {
    try {
      await ensureSubaccountEmailSynced({
        contaId: params.contaId,
        actor: params.actor ?? { type: 'SYSTEM' },
      });
    } catch (error) {
      try {
        console.warn('[finance.reconcileAsaasAccount] Falha ao sincronizar email da subconta', {
          contaId: params.contaId,
          financeProfileId: profile.id,
          asaasAccountId: asaasAccount.asaasAccountId,
          reason: params.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // noop
      }
    }
  }

  const myAccountStatus = await (async () => {
    if (!creds?.apiKey) return null;
    try {
      return await getMyAccountStatus({ apiKey: creds.apiKey });
    } catch (error) {
      const failure = classifyAsaasOperationalError(error, 'subaccount');

      try {
        console.warn('[finance.reconcileAsaasAccount] Falha ao consultar myAccount/status no Asaas', {
          category: failure.category,
          status: failure.status,
          contaId: params.contaId,
          financeProfileId: profile.id,
          asaasAccountId: asaasAccount.asaasAccountId,
          reason: params.reason,
          error: failure.message,
          retryable: failure.retryable,
          details: failure.details,
        });
      } catch {
        // noop
      }

      throw error;
    }
  })();

  if (myAccountStatus?.general) {
    await financeProfileService.syncRegulatoryState({
      contaId: params.contaId,
      asaasAccountId: asaasAccount.asaasAccountId,
      generalStatus: myAccountStatus.general,
      syncedAt: new Date(),
    });
  }

  const commercialInfoState = resolveCommercialInfoState({
    myAccountStatus,
    persistedStatus: asaasAccount.commercialInfoStatus ?? null,
    persistedScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
  });

  const mapped: { onboardingStatus: FinancialOnboardingStatus; financeStatus: FinanceStatus } = myAccountStatus
    ? mapMyAccountStatusToInternal(myAccountStatus)
    : { onboardingStatus: 'CREATED' as FinancialOnboardingStatus, financeStatus: 'FINANCE_PROFILE_COMPLETED' };

  const previousStatus = asaasAccount.status;
  const previousFinanceStatus = conta.financeStatus;
  const previousCommercialInfoStatus = asaasAccount.commercialInfoStatus ?? null;

  const shouldUpdateStatus = previousStatus !== mapped.onboardingStatus;
  const shouldUpdateFinanceStatus = previousFinanceStatus !== mapped.financeStatus;
  const shouldUpdateCommercialInfo =
    previousCommercialInfoStatus !== commercialInfoState.commercialInfoStatus ||
    (asaasAccount.commercialInfoScheduledDate ?? null) !== commercialInfoState.commercialInfoScheduledDate;

  if (!shouldUpdateStatus && !shouldUpdateFinanceStatus && !shouldUpdateCommercialInfo) {
    return {
      financeProfileId: profile.id,
      asaasAccountId: asaasAccount.asaasAccountId,
      previousStatus,
      updatedStatus: previousStatus,
      previousFinanceStatus,
      updatedFinanceStatus: previousFinanceStatus,
      previousCommercialInfoStatus,
      updatedCommercialInfoStatus: previousCommercialInfoStatus,
      updatedCommercialInfoScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
      reconciled: false,
      myAccountStatus,
    };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (shouldUpdateStatus) {
      await tx.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: { status: mapped.onboardingStatus, statusUpdatedAt: now },
        select: { id: true },
      });

      await tx.asaasAccountStatusHistory.create({
        data: {
          asaasAccountId: asaasAccount.id,
          oldStatus: previousStatus,
          newStatus: mapped.onboardingStatus,
          event: 'RECONCILE',
          payloadId: myAccountStatus?.general ? `general:${myAccountStatus.general}` : params.reason ?? null,
        },
        select: { id: true },
      });
    }

    if (shouldUpdateCommercialInfo) {
      await tx.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          commercialInfoStatus: commercialInfoState.commercialInfoStatus,
          commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
        },
        select: { id: true },
      });
    }

    if (shouldUpdateFinanceStatus) {
      await tx.conta.update({
        where: { id: params.contaId },
        data: { financeStatus: mapped.financeStatus },
        select: { id: true },
      });
    }
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.reconcile_asaas_account',
    entity: { type: 'AsaasAccount', id: asaasAccount.id },
    metadata: {
      reason: params.reason,
      previousStatus,
      updatedStatus: mapped.onboardingStatus,
      previousFinanceStatus,
      updatedFinanceStatus: mapped.financeStatus,
      generalStatus: myAccountStatus?.general ?? null,
      previousCommercialInfoStatus,
      updatedCommercialInfoStatus: commercialInfoState.commercialInfoStatus,
      updatedCommercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
    },
    actor: params.actor,
  });

  return {
    financeProfileId: profile.id,
    asaasAccountId: asaasAccount.asaasAccountId,
    previousStatus,
    updatedStatus: mapped.onboardingStatus,
    previousFinanceStatus,
    updatedFinanceStatus: mapped.financeStatus,
    previousCommercialInfoStatus,
    updatedCommercialInfoStatus: commercialInfoState.commercialInfoStatus,
    updatedCommercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
    reconciled: true,
    myAccountStatus,
  };
}
