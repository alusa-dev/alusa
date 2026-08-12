import { prisma } from '@alusa/database';
import type { AsaasCommercialInfoStatus, FinanceStatus, FinancialOnboardingStatus, KycProcessStatus } from '@prisma/client';

import { loadAsaasCredentials } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';
import { syncAsaasOperationalStatus } from '../foundation/asaas-operational-guard';
import { buildWebhookCacheV2, resolveCommercialInfoState } from '../use-cases/kyc/kyc-cache-utils';
import {
  getMyAccountDocumentsCached,
  getMyAccountStatusCached,
  invalidateKycAsaasReadCache,
} from '../use-cases/kyc/kyc-asaas-read-cache';
import { getDocumentsReadiness } from '../use-cases/kyc/kyc-document-group-resolver';
import { syncKycModels } from '../use-cases/kyc/kyc-persistence.service';
import {
  isDocumentEvent,
  isBankAccountEvent,
  isCommercialInfoEvent,
  isGeneralAccountStatusEvent,
  ACCOUNT_STATUS_EVENTS,
} from '../use-cases/kyc/kyc-state-machine';

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
  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.PENDING) return 'PENDING_DOCUMENTS';
  if (event === ACCOUNT_STATUS_EVENTS.GENERAL.AWAITING_APPROVAL) return 'UNDER_REVIEW';
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
    eventCreatedAt?: string | null;
    scheduledDate?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { id: true, onboardingCompletedAt: true },
  });
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
      provisionedAt: true,
      lastAccountStatusEventAt: true,
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
  const parsedEventCreatedAt = params.eventCreatedAt ? new Date(params.eventCreatedAt) : null;
  const eventCreatedAt = parsedEventCreatedAt && !Number.isNaN(parsedEventCreatedAt.getTime())
    ? parsedEventCreatedAt
    : now;

  const shouldRefreshDocuments =
    isDocumentEvent(params.event)
    || isBankAccountEvent(params.event)
    || isCommercialInfoEvent(params.event);

  // Eventos de áreas não alteram a aprovação geral. O snapshot observado fica
  // no cache, enquanto somente ACCOUNT_STATUS_GENERAL_APPROVAL_* projeta o
  // estado canônico da conta.
  if (!isGeneralAccountStatusEvent(params.event)) {
    if (shouldRefreshDocuments) {
      await refreshDocumentsCacheV2(contaId, asaasAccount.id, params.payloadId ?? undefined);
    }
    await syncAsaasOperationalStatus(contaId);
    return { success: true };
  }

  if (
    asaasAccount.lastAccountStatusEventAt
    && eventCreatedAt < asaasAccount.lastAccountStatusEventAt
  ) {
    await auditLogService.record({
      contaId,
      action: 'finance.onboarding.out_of_order_event_ignored',
      entity: { type: 'AsaasAccount', id: asaasAccount.id },
      metadata: {
        event: params.event,
        payloadId: params.payloadId ?? undefined,
        eventCreatedAt: eventCreatedAt.toISOString(),
        lastAccountStatusEventAt: asaasAccount.lastAccountStatusEventAt.toISOString(),
      },
      actor: { type: 'SYSTEM' },
    });
    return { success: true };
  }

  const regulatoryStatus = params.event === ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED
    ? 'APPROVED' as const
    : params.event === ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED
      ? 'REJECTED' as const
      : 'PENDING' as const;
  const kycStatus = mapEventToKycStatus(params.event) ?? 'UNDER_REVIEW';

  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.asaasAccount.updateMany({
      where: {
        id: asaasAccount.id,
        status: oldStatus,
        lastAccountStatusEventAt: asaasAccount.lastAccountStatusEventAt,
      },
      data: {
        status: mapped.onboardingStatus,
        statusUpdatedAt: now,
        lastAccountStatusEventAt: eventCreatedAt,
      },
    });

    if (claimed.count === 0) return false;

    if (oldStatus !== mapped.onboardingStatus) {
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
    }

    await tx.financeProfile.update({
      where: { id: profile.id },
      data: {
        asaasAccountId: asaasAccount.asaasAccountId ?? undefined,
        status: regulatoryStatus,
        isOnboardingCompleted: regulatoryStatus === 'APPROVED',
        onboardingCompletedAt:
          regulatoryStatus === 'APPROVED' ? profile.onboardingCompletedAt ?? now : null,
        lastAsaasSyncAt: now,
      },
      select: { id: true },
    });

    await tx.kycProcess.upsert({
      where: { asaasAccountId: asaasAccount.id },
      create: {
        asaasAccountId: asaasAccount.id,
        status: kycStatus,
        rejectReasons: [],
        lastWebhookEventId: params.payloadId ?? null,
        lastAsaasSyncAt: now,
      },
      update: {
        status: kycStatus,
        ...(params.payloadId ? { lastWebhookEventId: params.payloadId } : {}),
        lastAsaasSyncAt: now,
      },
      select: { id: true },
    });

    await tx.conta.update({
      where: { id: contaId },
      data: { financeStatus: mapped.financeStatus },
      select: { id: true },
    });
    return true;
  });

  if (!applied) {
    await auditLogService.record({
      contaId,
      action: 'finance.onboarding.concurrent_event_deferred',
      entity: { type: 'AsaasAccount', id: asaasAccount.id },
      metadata: { event: params.event, payloadId: params.payloadId ?? undefined },
      actor: { type: 'SYSTEM' },
    });
    return { success: true };
  }

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
        provisionedAt: true,
      },
    });

    if (!getDocumentsReadiness(currentAccount?.provisionedAt ?? null).ready) return;

    // Eventos de reprovação podem gerar um novo onboardingUrl. Invalida o
    // cache de processo antes da reconciliação para que a nova URL não fique
    // escondida por uma leitura anterior.
    invalidateKycAsaasReadCache(creds.apiKey);

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
      source: 'READ_MODEL',
    }).catch(() => {});
  } catch {
    // best-effort
  }
}
