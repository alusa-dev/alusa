import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { featureFlagsService } from '../foundation/feature-flags.service';
import { getBalance } from './get-balance';
import { getTransferFees, type GetTransferFeesOutput } from './get-transfer-fees';
import { getKycSummary, type GetKycSummaryResult } from './kyc/get-kyc-summary';
import { resolveTenantTransferContext } from './transfers/asaas-transfer-payload';

export interface GetAccountBalanceSummaryInput {
  contaId: string;
  kycSummary?: GetKycSummaryResult;
}

export interface GetAccountBalanceSummaryOutput {
  balance: {
    available: number;
    syncedAt: string;
  };
  financialAccount: {
    status: 'READY' | 'PENDING_ACTIVATION' | 'UNAVAILABLE';
    canTransfer: boolean;
    canPixCopyPaste: boolean;
    reasonCode: string | null;
  };
  features: {
    manualWithdrawEnabled: boolean;
    pixTransferEnabled: boolean;
    bankTransferEnabled: boolean;
  };
  fees: GetTransferFeesOutput | null;
  transferContext: {
    tenantDocumentType: 'CPF' | 'CNPJ' | null;
    tenantDocumentLastDigits: string | null;
    tenantDocumentNormalized: string | null;
  };
}

export type GetAccountBalanceSummaryError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CARREGAR_CONTA';

export async function getAccountBalanceSummary(
  input: GetAccountBalanceSummaryInput,
): Promise<Result<GetAccountBalanceSummaryOutput, GetAccountBalanceSummaryError>> {
  await withSummaryPerf('ensureTransferFeaturesForApprovedAccount', () =>
    featureFlagsService.ensureTransferFeaturesForApprovedAccount({
      contaId: input.contaId,
      reason: 'getAccountBalanceSummary',
    }),
    { contaId: input.contaId },
  );

  const [
    balanceResult,
    transferFeesResult,
    kycSummary,
    kycApproved,
    transferFlags,
    tenantDocument,
  ] = await Promise.all([
    withSummaryPerf('getBalance', () => getBalance({ contaId: input.contaId }), { contaId: input.contaId }),
    withSummaryPerf('getTransferFees', () => getTransferFees({ contaId: input.contaId }), { contaId: input.contaId }),
    input.kycSummary
      ? Promise.resolve(input.kycSummary)
      : withSummaryPerf('getKycSummary', () => getKycSummary(input.contaId), { contaId: input.contaId }),
    withSummaryPerf('resolveKycApprovalFromLocalState', () => resolveKycApprovalFromLocalState(input.contaId), {
      contaId: input.contaId,
    }),
    withSummaryPerf('getTransferFeatureFlags', () => featureFlagsService.getTransferFeatureFlags(input.contaId), {
      contaId: input.contaId,
    }),
    withSummaryPerf('resolveTenantDocument', () => resolveTenantDocument(input.contaId), { contaId: input.contaId }),
  ]);

  if (!balanceResult.success) {
    return err(
      balanceResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
        ? 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
        : 'ERRO_AO_CARREGAR_CONTA',
    );
  }

  return ok({
    balance: {
      available: balanceResult.data.balance,
      syncedAt: new Date().toISOString(),
    },
    financialAccount: resolveFinancialAccountState({
      kycSummary,
      kycApproved,
      manualWithdrawEnabled: transferFlags.manualWithdrawEnabled,
      pixTransferEnabled: transferFlags.pixTransferEnabled,
    }),
    features: {
      manualWithdrawEnabled: transferFlags.manualWithdrawEnabled,
      pixTransferEnabled: transferFlags.pixTransferEnabled,
      bankTransferEnabled: transferFlags.bankTransferEnabled,
    },
    fees: transferFeesResult.success ? transferFeesResult.data : null,
    transferContext: resolveTenantTransferContext(tenantDocument),
  });
}

async function resolveTenantDocument(contaId: string): Promise<string | null> {
  const [conta, profile] = await Promise.all([
    prisma.conta.findUnique({
      where: { id: contaId },
      select: { cpfCnpj: true },
    }),
    prisma.financeProfile.findUnique({
      where: { contaId },
      select: { draftCpfCnpj: true },
    }),
  ]);

  return profile?.draftCpfCnpj ?? conta?.cpfCnpj ?? null;
}

async function resolveKycApprovalFromLocalState(contaId: string): Promise<boolean> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      isOnboardingCompleted: true,
      asaasAccount: {
        select: {
          status: true,
        },
      },
    },
  });

  return Boolean(profile?.isOnboardingCompleted || profile?.asaasAccount?.status === 'APPROVED');
}

function resolveFinancialAccountState(params: {
  kycSummary: GetKycSummaryResult;
  kycApproved: boolean;
  manualWithdrawEnabled: boolean;
  pixTransferEnabled: boolean;
}): GetAccountBalanceSummaryOutput['financialAccount'] {
  const { kycSummary, kycApproved, manualWithdrawEnabled, pixTransferEnabled } = params;

  if (kycSummary.asaasConnection.status === 'MISCONFIGURED') {
    return {
      status: 'UNAVAILABLE',
      canTransfer: false,
      canPixCopyPaste: false,
      reasonCode: kycSummary.asaasConnection.reasonCode ?? 'MISCONFIGURED',
    };
  }

  if (kycSummary.asaasConnection.status !== 'CONNECTED') {
    return {
      status: 'PENDING_ACTIVATION',
      canTransfer: false,
      canPixCopyPaste: false,
      reasonCode: kycSummary.asaasConnection.reasonCode ?? 'NOT_CONNECTED',
    };
  }

  if (!kycApproved) {
    return {
      status: 'PENDING_ACTIVATION',
      canTransfer: false,
      canPixCopyPaste: false,
      reasonCode: 'KYC_NAO_APROVADO',
    };
  }

  if (!manualWithdrawEnabled) {
    return {
      status: 'READY',
      canTransfer: false,
      canPixCopyPaste: false,
      reasonCode: 'FEATURE_DISABLED',
    };
  }

  return {
    status: 'READY',
    canTransfer: true,
    canPixCopyPaste: pixTransferEnabled,
    reasonCode: null,
  };
}

type PerfMetadata = Record<string, unknown>;

async function withSummaryPerf<T>(
  _operation: string,
  fn: () => Promise<T>,
  _metadata?: PerfMetadata,
): Promise<T> {
  return fn();
}
