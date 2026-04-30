import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import type { LedgerEntry, ExtratoSummary } from '../dtos/ledger';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { getBalance } from './get-balance';
import { getExtrato } from './get-extrato';
import { getKycSummary } from './kyc/get-kyc-summary';
import { getTransferFees, type GetTransferFeesOutput } from './get-transfer-fees';
import { parseWithdrawDestination, summarizeWithdrawDestination } from './transfers/recipient-utils';

export interface GetAccountOverviewInput {
  contaId: string;
}

export interface AccountOverviewTransferItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  statusUpdatedAt: string;
  description: string | null;
  destinationLabel: string;
  destinationDetail: string;
  destinationType: 'PIX' | 'BANK_ACCOUNT';
}

export interface GetAccountOverviewOutput {
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
  statementPreview: {
    summary: ExtratoSummary;
    items: LedgerEntry[];
  };
  recentTransfers: {
    items: AccountOverviewTransferItem[];
    total: number;
  };
}

export type GetAccountOverviewError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CARREGAR_CONTA';

const EMPTY_SUMMARY: ExtratoSummary = {
  receitas: 0,
  despesas: 0,
  estornos: 0,
  liquido: 0,
};

export async function getAccountOverview(
  input: GetAccountOverviewInput,
): Promise<Result<GetAccountOverviewOutput, GetAccountOverviewError>> {
  await featureFlagsService.ensureTransferFeaturesForApprovedAccount({
    contaId: input.contaId,
    reason: 'getAccountOverview',
  });

  const [
    balanceResult,
    transferFeesResult,
    kycSummary,
    kycApproved,
    manualWithdrawEnabled,
    pixTransferEnabled,
    bankTransferEnabled,
    extratoResult,
    totalTransfers,
    recentTransfersRaw,
  ] = await Promise.all([
    getBalance({ contaId: input.contaId }),
    getTransferFees({ contaId: input.contaId }),
    getKycSummary(input.contaId),
    requireKycApproved(input.contaId),
    featureFlagsService.isEnabled(input.contaId, 'enableManualWithdraw'),
    featureFlagsService.isEnabled(input.contaId, 'enablePixTransfer'),
    featureFlagsService.isEnabled(input.contaId, 'enableBankTransfer'),
    getExtrato({
      contaId: input.contaId,
      query: { page: 1, pageSize: 5, sort: 'date', direction: 'desc' },
    }),
    prisma.transferRequest.count({ where: { contaId: input.contaId } }),
    prisma.transferRequest.findMany({
      where: { contaId: input.contaId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        value: true,
        status: true,
        createdAt: true,
        statusUpdatedAt: true,
        description: true,
        destination: true,
      },
    }),
  ]);

  if (!balanceResult.success) {
    return err(
      balanceResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
        ? 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
        : 'ERRO_AO_CARREGAR_CONTA',
    );
  }

  const financialAccount = resolveFinancialAccountState({
    kycSummary,
    kycApproved: kycApproved.success,
    manualWithdrawEnabled,
    pixTransferEnabled,
  });

  const recentTransfers: AccountOverviewTransferItem[] = recentTransfersRaw.map((row) => {
    const destination = parseWithdrawDestination(row.destination);
    const summary = destination ? summarizeWithdrawDestination(destination) : null;

    return {
      id: row.id,
      amount: Number(row.value),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      statusUpdatedAt: row.statusUpdatedAt.toISOString(),
      description: row.description ?? null,
      destinationLabel: summary?.label ?? 'Destino indisponível',
      destinationDetail: summary?.detail ?? 'Sem detalhes do destinatário',
      destinationType: summary?.type ?? 'BANK_ACCOUNT',
    };
  });

  return ok({
    balance: {
      available: balanceResult.data.balance,
      syncedAt: new Date().toISOString(),
    },
    financialAccount,
    features: {
      manualWithdrawEnabled,
      pixTransferEnabled,
      bankTransferEnabled,
    },
    fees: transferFeesResult.success ? transferFeesResult.data : null,
    statementPreview: extratoResult.success
      ? {
          summary: extratoResult.data.summary,
          items: extratoResult.data.transactions,
        }
      : {
          summary: EMPTY_SUMMARY,
          items: [],
        },
    recentTransfers: {
      items: recentTransfers,
      total: totalTransfers,
    },
  });
}

function resolveFinancialAccountState(params: {
  kycSummary: Awaited<ReturnType<typeof getKycSummary>>;
  kycApproved: boolean;
  manualWithdrawEnabled: boolean;
  pixTransferEnabled: boolean;
}): GetAccountOverviewOutput['financialAccount'] {
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