import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { prisma } from '@alusa/database';

import { financeProfileService } from './finance-profile.service';
import { isPendingDocumentsBlockBypassedForTesting } from './kyc-test-bypass';
import { getKycSnapshot } from '../use-cases/kyc/get-kyc-snapshot';
import type { KycSnapshot } from '../dtos/kyc/kyc-snapshot.dto';

function isLocalMockPaymentsRuntime() {
  return (
    (process.env.PAYMENTS_PROVIDER_MODE === 'mock' || process.env.PLAYWRIGHT_TEST === 'true') &&
    (process.env.NODE_ENV !== 'production' || process.env.PLAYWRIGHT_TEST === 'true')
  );
}

/**
 * O runtime E2E usa uma conta financeira local aprovada, mas não possui uma
 * subconta Asaas real. Mantemos o mesmo contrato do guard de produção e só
 * aceitamos o atalho quando o fixture marcou explicitamente todos os estados
 * locais como operacionais. Nenhum tenant pendente é promovido por ambiente.
 */
async function getLocalMockApprovedSnapshot(
  profile: Awaited<ReturnType<typeof financeProfileService.getOrCreateByTenant>>,
): Promise<KycSnapshot | null> {
  if (!isLocalMockPaymentsRuntime()) return null;

  const account = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: {
      status: true,
      asaasAccountId: true,
      apiKeyStatus: true,
      operationalStatus: true,
      webhookStatus: true,
    },
  });

  const approved =
    profile.status === 'APPROVED' &&
    profile.isOnboardingCompleted &&
    account?.status === 'APPROVED' &&
    Boolean(account.asaasAccountId) &&
    account.apiKeyStatus === 'CONNECTED' &&
    account.operationalStatus === 'OPERATIONAL' &&
    account.webhookStatus === 'ACTIVE';

  if (!approved) return null;

  return {
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
    isSandbox: true,
  };
}

export type RequireKycApprovedError = 'KYC_NAO_APROVADO' | 'ERRO_INTERNO';

/**
 * Guard legado para operações financeiras que não exigem liquidação bancária
 * (cobranças, clientes e assinaturas). Mantido para compatibilidade, mas
 * delega para o snapshot canônico. Saques/transferências usam o guard de
 * snapshot diretamente e continuam exigindo bankAccountInfo aprovado.
 */
export async function requireKycApproved(
  contaId: string,
  options: RequireKycSnapshotApprovedOptions = { allowPendingBankAccount: true },
): Promise<Result<true, RequireKycApprovedError>> {
  const result = await requireKycSnapshotApproved(contaId, options);
  if (result.success) return ok(true);
  if (result.error.code === 'ERRO_INTERNO') {
    return err('ERRO_INTERNO');
  }
  return err('KYC_NAO_APROVADO');
}

// ── Guard baseado em KycSnapshot (novo) ──────────────────────────────────

export type RequireKycSnapshotApprovedError =
  | { code: 'KYC_REQUIRED'; reasons: string[]; snapshot: KycSnapshot }
  | { code: 'COMMERCIAL_INFO_EXPIRED'; reasons: string[]; snapshot: KycSnapshot }
  | { code: 'ERRO_INTERNO' };

export type RequireKycSnapshotApprovedOptions = {
  /**
   * Permite operar cobranças quando apenas a análise da conta bancária está
   * pendente. Essa área não é pré-requisito para criar cobranças no Asaas;
   * continua sendo exibida separadamente para recursos de liquidação.
   */
  allowPendingBankAccount?: boolean;
};

/**
 * Guard canônico baseado em KycSnapshot.
 * Por padrão, bloqueia se general/documentation/bankAccountInfo !== APPROVED.
 * Operações que não dependem de liquidação bancária podem permitir a pendência
 * de bankAccountInfo via allowPendingBankAccount.
 *
 * @returns ok(snapshot) quando aprovado; err com reasons quando pendente.
 */
export async function requireKycSnapshotApproved(
  contaId: string,
  options: RequireKycSnapshotApprovedOptions = {},
): Promise<Result<KycSnapshot, RequireKycSnapshotApprovedError>> {
  try {
    const fp = await financeProfileService.getOrCreateByTenant(contaId);
    const localMockSnapshot = await getLocalMockApprovedSnapshot(fp);
    if (localMockSnapshot) return ok(localMockSnapshot);
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
    const coreKycApproved = (snapshot: KycSnapshot) =>
      snapshot.generalStatus === 'APPROVED' && snapshot.documentationStatus === 'APPROVED';
    const isApprovedForOperation = (snapshot: KycSnapshot) =>
      !snapshot.hasBlockingPending || (options.allowPendingBankAccount === true && coreKycApproved(snapshot));

    if (fp.isOnboardingCompleted) {
      const snapshot = await getKycSnapshot(fp.id);
      if (snapshot && isApprovedForOperation(snapshot)) return ok(snapshot);
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

    if (snapshot.hasBlockingPending && options.allowPendingBankAccount === true && coreKycApproved(snapshot)) {
      return ok(snapshot);
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
