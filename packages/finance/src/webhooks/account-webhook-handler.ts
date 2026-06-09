import { prisma } from '@alusa/database';
import type { AsaasCommercialInfoStatus, FinanceStatus, FinancialOnboardingStatus, KycProcessStatus } from '@prisma/client';

import { loadAsaasCredentials } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';
import { syncAsaasOperationalStatus } from '../foundation/asaas-operational-guard';
import { financeProfileService } from '../foundation/finance-profile.service';
import { buildWebhookCacheV2, resolveCommercialInfoState } from '../use-cases/kyc/kyc-cache-utils';
import { getMyAccountDocumentsCached, getMyAccountStatusCached } from '../use-cases/kyc/kyc-asaas-read-cache';
import { syncKycModels, updateKycProcessStatus } from '../use-cases/kyc/kyc-persistence.service';
import {
  isOnboardingTransitionValid,
  isDocumentEvent,
  isBankAccountEvent,
  isAuthoritativeEvent,
  ACCOUNT_STATUS_EVENTS,
} from '../use-cases/kyc/kyc-state-machine';

// ── Status monotonicity ────────────────────────────────────────────────────
const STATUS_PRECEDENCE: Partial<Record<FinancialOnboardingStatus, number>> = {
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  READY_FOR_PROVISIONING: 0,
  PROVISIONING: 0,
  CREATED: 0,
  UNDER_REVIEW: 1,
  REJECTED: 2,
  APPROVED: 3,
  PROVISIONING_FAILED: 0,
};

function isStatusDowngrade(
  current: FinancialOnboardingStatus,
  incoming: FinancialOnboardingStatus,
): boolean {
  return (STATUS_PRECEDENCE[current] ?? 0) > (STATUS_PRECEDENCE[incoming] ?? 0);
}

function mapAccountEvent(event: string): {
  onboardingStatus: FinancialOnboardingStatus;
  financeStatus: FinanceStatus;
} {
  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED) {
    return { onboardingStatus: 'APPROVED', financeStatus: 'FINANCE_APPROVED' };
  }

  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED) {
    return { onboardingStatus: 'REJECTED', financeStatus: 'FINANCE_REJECTED' };
  }

  return { onboardingStatus: 'UNDER_REVIEW', financeStatus: 'FINANCE_IN_ANALYSIS' };
}

function mapEventToKycStatus(event: string): KycProcessStatus | null {
  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED) return 'APPROVED';
  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED) return 'REJECTED';
  if (event === ACCOUNT_STATUS_EVENTS.DOCUMENT.APPROVED) return 'UNDER_REVIEW';
  if (event === ACCOUNT_STATUS_EVENTS.DOCUMENT.REJECTED) return 'REJECTED';
  if (event === ACCOUNT_STATUS_EVENTS.DOCUMENT.PENDING) return 'UNDER_REVIEW';
  if (event === ACCOUNT_STATUS_EVENTS.DOCUMENT.AWAITING_APPROVAL) return 'UNDER_REVIEW';
  if (event === ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.APPROVED) return 'UNDER_REVIEW';
  if (event === ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.REJECTED) return 'REJECTED';
  if (event === ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.PENDING) return 'UNDER_REVIEW';
  if (event === ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.AWAITING_APPROVAL) return 'UNDER_REVIEW';
  return null;
}

export async function handleAccountWebhook(
  contaId: string,
  params: {
    event: string;
    payloadId?: string | null;
    scheduledDate?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });
  if (!profile) {
    return { success: false, error: 'FinanceProfile não encontrado' };
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

  if (!asaasAccount) {
    return { success: false, error: 'AsaasAccount não encontrado' };
  }

  const commercialInfoStatus = (() => {
    if (params.event === ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRING_SOON) return 'EXPIRING_SOON' as const;
    if (params.event === ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRED) return 'EXPIRED' as const;
    return null;
  })();

  if (commercialInfoStatus) {
    const scheduledDate = params.scheduledDate?.trim() || null;
    const shouldUpdateStatus = asaasAccount.commercialInfoStatus !== commercialInfoStatus;
    const shouldUpdateSchedule =
      scheduledDate && scheduledDate !== asaasAccount.commercialInfoScheduledDate;

    if (shouldUpdateStatus || shouldUpdateSchedule) {
      await prisma.asaasAccount.update({
        where: { id: asaasAccount.id },
        data: {
          commercialInfoStatus: commercialInfoStatus as AsaasCommercialInfoStatus,
          ...(scheduledDate ? { commercialInfoScheduledDate: scheduledDate } : {}),
        },
        select: { id: true },
      });

      await auditLogService.record({
        contaId,
        action: 'finance.onboarding.commercial_info_status_changed',
        entity: { type: 'AsaasAccount', id: asaasAccount.id },
        metadata: {
          event: params.event,
          payloadId: params.payloadId ?? undefined,
          commercialInfoStatus,
          scheduledDate: scheduledDate ?? undefined,
        },
        actor: { type: 'SYSTEM' },
      });
    }

    // Refresh cache para consistência com Asaas (best-effort)
    await refreshDocumentsCacheV2(contaId, asaasAccount.id, params.payloadId ?? undefined).catch(() => {});

    return { success: true };
  }

  const mapped = mapAccountEvent(params.event);
  const oldStatus = asaasAccount.status;

  const now = new Date();

  if (params.event === ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED) {
    await financeProfileService.syncRegulatoryState({
      contaId,
      asaasAccountId: asaasAccount.asaasAccountId ?? null,
      generalStatus: 'APPROVED',
      syncedAt: now,
    });
  } else if (params.event === ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED) {
    await financeProfileService.syncRegulatoryState({
      contaId,
      asaasAccountId: asaasAccount.asaasAccountId ?? null,
      generalStatus: 'REJECTED',
      syncedAt: now,
    });
  }

  const shouldRefreshDocuments = isDocumentEvent(params.event) || isBankAccountEvent(params.event);

  // ── Monotonicidade + state machine ─────────────────────────────────────
  // Valida se a transição é permitida pela máquina de estados.
  // Se não for autoritativo e o resultado seria um downgrade, verifica via GET fresh.
  const transitionCheck = isOnboardingTransitionValid(oldStatus, mapped.onboardingStatus, params.event);

  if (
    !transitionCheck.allowed ||
    (!isAuthoritativeEvent(params.event) && isStatusDowngrade(oldStatus, mapped.onboardingStatus))
  ) {
    let confirmedDowngrade = false;

    try {
      const creds = await loadAsaasCredentials(contaId);
      if (creds) {
        const freshStatus = await getMyAccountStatusCached(
          { apiKey: creds.apiKey },
          { forceRefresh: true, intent: 'RECONCILIATION' },
        );
        const freshGeneral = freshStatus?.general?.toUpperCase() ?? '';

        // Só confirma downgrade se status fresh não for APPROVED
        if (freshGeneral !== 'APPROVED') {
          confirmedDowngrade = true;
        }
      }
    } catch {
      // Em caso de erro no fetch, mantém estado atual (conservador)
    }

    if (!confirmedDowngrade) {
      await auditLogService.record({
        contaId,
        action: 'finance.onboarding.downgrade_blocked',
        entity: { type: 'AsaasAccount', id: asaasAccount.id },
        metadata: {
          event: params.event,
          payloadId: params.payloadId ?? undefined,
          currentStatus: oldStatus,
          incomingStatus: mapped.onboardingStatus,
          reason: 'monotonicity_guard',
        },
        actor: { type: 'SYSTEM' },
      });

      // Ainda faz refresh de documentos (cache) mas NÃO altera status
      if (shouldRefreshDocuments) {
        await refreshDocumentsCacheV2(contaId, asaasAccount.id, params.payloadId ?? undefined);
      }

      return { success: true };
    }
  }

  if (oldStatus === mapped.onboardingStatus) {
    await prisma.conta.update({
      where: { id: contaId },
      data: { financeStatus: mapped.financeStatus },
      select: { id: true },
    });

    if (shouldRefreshDocuments) {
      await refreshDocumentsCacheV2(contaId, asaasAccount.id, params.payloadId ?? undefined);
    }

    return { success: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        status: mapped.onboardingStatus,
        statusUpdatedAt: now,
      },
      select: { id: true },
    });

    await tx.asaasAccountStatusHistory.create({
      data: {
        asaasAccountId: asaasAccount.id,
        oldStatus,
        newStatus: mapped.onboardingStatus,
        event: params.event,
        payloadId: params.payloadId ?? null,
      },
      select: { id: true },
    });

    await tx.conta.update({
      where: { id: contaId },
      data: { financeStatus: mapped.financeStatus },
      select: { id: true },
    });
  });

  await auditLogService.record({
    contaId,
    action: 'finance.onboarding.account_status_changed',
    entity: { type: 'AsaasAccount', id: asaasAccount.id },
    metadata: {
      event: params.event,
      payloadId: params.payloadId ?? undefined,
      oldStatus,
      newStatus: mapped.onboardingStatus,
    },
    actor: { type: 'SYSTEM' },
  });

  if (shouldRefreshDocuments) {
    await refreshDocumentsCacheV2(contaId, asaasAccount.id, params.payloadId ?? undefined);
  }

  // Atualiza KycProcess com status derivado do evento (best-effort)
  const kycStatus = mapEventToKycStatus(params.event);
  if (kycStatus) {
    await updateKycProcessStatus({
      asaasAccountId: asaasAccount.id,
      status: kycStatus,
      webhookEventId: params.payloadId ?? undefined,
    }).catch(() => {});
  }

  await syncAsaasOperationalStatus(contaId);

  return { success: true };
}

// ── Helper: refresh cache v2 best-effort ─────────────────────────────────

async function refreshDocumentsCacheV2(
  contaId: string,
  asaasAccountId: string,
  webhookEventId?: string,
): Promise<void> {
  try {
    const creds = await loadAsaasCredentials(contaId);
    if (!creds) return;

    const currentAccount = await prisma.asaasAccount.findUnique({
      where: { id: asaasAccountId },
      select: {
        commercialInfoStatus: true,
        commercialInfoScheduledDate: true,
      },
    });

    const [status, docs] = await Promise.all([
      getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'RECONCILIATION' }),
      getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'RECONCILIATION' }),
    ]);

    const commercialInfoState = resolveCommercialInfoState({
      myAccountStatus: status,
      persistedStatus: currentAccount?.commercialInfoStatus ?? null,
      persistedScheduledDate: currentAccount?.commercialInfoScheduledDate ?? null,
    });

    const cachePayload = buildWebhookCacheV2({ myAccountStatus: status, documents: docs });
    const shouldUpdateCommercialInfo =
      currentAccount?.commercialInfoStatus !== commercialInfoState.commercialInfoStatus ||
      currentAccount?.commercialInfoScheduledDate !== commercialInfoState.commercialInfoScheduledDate;

    await prisma.asaasAccount.update({
      where: { id: asaasAccountId },
      data: {
        ...(shouldUpdateCommercialInfo
          ? {
              commercialInfoStatus: commercialInfoState.commercialInfoStatus,
              commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
            }
          : {}),
        documentsCache: cachePayload as unknown as object,
        documentsCacheUpdatedAt: new Date(),
      },
      select: { id: true },
    });

    // Sincroniza modelos KYC (best-effort, idempotente)
    await syncKycModels({
      asaasAccountId,
      myAccountStatus: status,
      documents: docs,
      webhookEventId,
    }).catch(() => {});
  } catch {
    // best-effort
  }
}
