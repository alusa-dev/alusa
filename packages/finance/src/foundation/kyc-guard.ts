import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { financeProfileService } from './finance-profile.service';
import { isPendingDocumentsBlockBypassedForTesting } from './kyc-test-bypass';
import { reconcileAsaasAccount } from '../use-cases/asaas-account/reconcile-asaas-account';
import { getKycSnapshot } from '../use-cases/kyc/get-kyc-snapshot';
import type { KycSnapshot } from '../dtos/kyc/kyc-snapshot.dto';

export type RequireKycApprovedError = 'KYC_NAO_APROVADO' | 'ERRO_INTERNO';

/**
 * Guard legado — verifica status via AsaasAccount.status.
 * Mantido para compatibilidade; preferir requireKycSnapshotApproved.
 */
export async function requireKycApproved(contaId: string): Promise<Result<true, RequireKycApprovedError>> {
  try {
    if (isPendingDocumentsBlockBypassedForTesting()) {
      return ok(true);
    }

    const financeProfile = await financeProfileService.getOrCreateByTenant(contaId);

    if (financeProfile.isOnboardingCompleted) return ok(true);

    const asaasAccount = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true },
    });

    if (!asaasAccount || asaasAccount.status !== 'APPROVED') {
      try {
        await reconcileAsaasAccount({ contaId, reason: 'requireKycApproved' });
        const refreshed = await prisma.financeProfile.findUnique({
          where: { id: financeProfile.id },
          select: { isOnboardingCompleted: true },
        });
        if (refreshed?.isOnboardingCompleted) return ok(true);
      } catch {
        // best-effort
      }

      return err('KYC_NAO_APROVADO');
    }

    return ok(true);
  } catch {
    return err('ERRO_INTERNO');
  }
}

// ── Guard baseado em KycSnapshot (novo) ──────────────────────────────────

export type RequireKycSnapshotApprovedError =
  | { code: 'KYC_REQUIRED'; reasons: string[]; snapshot: KycSnapshot }
  | { code: 'COMMERCIAL_INFO_EXPIRED'; reasons: string[]; snapshot: KycSnapshot }
  | { code: 'ERRO_INTERNO' };

/**
 * Guard canônico baseado em KycSnapshot.
 * Bloqueia se general/documentation/bankAccountInfo !== APPROVED.
 *
 * @returns ok(snapshot) quando aprovado; err com reasons quando pendente.
 */
export async function requireKycSnapshotApproved(
  contaId: string,
): Promise<Result<KycSnapshot, RequireKycSnapshotApprovedError>> {
  try {
    const fp = await financeProfileService.getOrCreateByTenant(contaId);
    const bypassPendingDocumentsBlock = isPendingDocumentsBlockBypassedForTesting();

    if (bypassPendingDocumentsBlock) {
      const snapshot = await getKycSnapshot(fp.id, { fresh: true });

      return ok(
        snapshot
          ? {
              ...snapshot,
              generalStatus: 'APPROVED',
              documentationStatus: 'APPROVED',
              bankAccountStatus: 'APPROVED',
              processStatus: 'APPROVED',
              hasBlockingPending: false,
            }
          : {
              generalStatus: 'APPROVED',
              documentationStatus: 'APPROVED',
              bankAccountStatus: 'APPROVED',
              commercialInfoAreaStatus: 'APPROVED',
              processStatus: 'APPROVED',
              commercialInfoStatus: null,
              commercialInfoScheduledDate: null,
              commercialInfoExpiration: null,
              hasBlockingPending: false,
              nextActions: [],
              rejectReasons: [],
              fetchedAt: new Date().toISOString(),
              isSandbox: false,
            },
      );
    }

    // Fast-path: onboarding já completo
    if (fp.isOnboardingCompleted) {
      const snapshot = await getKycSnapshot(fp.id);
      if (snapshot && !snapshot.hasBlockingPending) return ok(snapshot);
      // Se snapshot diz blocking mesmo com onboarding completo, reconcilia
    }

    const snapshot = await getKycSnapshot(fp.id, { fresh: true });
    if (!snapshot) {
      return err({ code: 'KYC_REQUIRED', reasons: ['Subconta não disponível'], snapshot: {
        generalStatus: 'UNKNOWN',
        documentationStatus: 'UNKNOWN',
        bankAccountStatus: 'UNKNOWN',
        processStatus: 'PENDING_DOCUMENTS',
        commercialInfoAreaStatus: 'PENDING',
        commercialInfoStatus: null,
        commercialInfoScheduledDate: null,
        commercialInfoExpiration: null,
        hasBlockingPending: true,
        nextActions: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
        isSandbox: false,
      }});
    }

    if (snapshot.commercialInfoStatus === 'EXPIRED') {
      return err({ code: 'COMMERCIAL_INFO_EXPIRED', reasons: ['commercialInfo: EXPIRED'], snapshot });
    }

    if (snapshot.hasBlockingPending) {
      const reasons: string[] = [];
      if (snapshot.generalStatus !== 'APPROVED') reasons.push(`general: ${snapshot.generalStatus}`);
      if (snapshot.documentationStatus !== 'APPROVED') reasons.push(`documentation: ${snapshot.documentationStatus}`);
      if (snapshot.bankAccountStatus !== 'APPROVED') reasons.push(`bankAccount: ${snapshot.bankAccountStatus}`);
      return err({ code: 'KYC_REQUIRED', reasons, snapshot });
    }

    return ok(snapshot);
  } catch {
    return err({ code: 'ERRO_INTERNO' });
  }
}
