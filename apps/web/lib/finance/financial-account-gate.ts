import { NextResponse } from 'next/server';

import {
  getKycSummary,
  getKycSummaryFresh,
  requireKycSnapshotApproved,
  type GetKycSummaryResult,
} from '@alusa/finance';
import { prisma } from '@alusa/database';

export type FinancialAccountStatus = 'PENDING_ACTIVATION' | 'UNAVAILABLE';
export type FinancialAccountGateCode =
  | 'FINANCIAL_ACCOUNT_NOT_READY'
  | 'FINANCIAL_ACCOUNT_UNAVAILABLE'
  | 'KYC_REQUIRED'
  | 'COMMERCIAL_INFO_EXPIRED';

export type FinancialAccountGatePayload = {
  code: FinancialAccountGateCode;
  financialAccount: { status: FinancialAccountStatus };
  reasons?: string[];
  redirectTo?: string;
};

type GateResult =
  | { ok: true; summary: GetKycSummaryResult }
  | { ok: false; response: NextResponse<FinancialAccountGatePayload> };

const APPROVED_GATE_CACHE_TTL_MS = 30_000;
const approvedGateCache = new Map<string, { expiresAt: number; summary: GetKycSummaryResult }>();

function json<T>(status: number, body: T) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function isLocalMockFinancialGateEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.PAYMENTS_PROVIDER_MODE === 'mock';
}

async function getLocalMockApprovedSummary(contaId: string): Promise<GetKycSummaryResult | null> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      financeStatus: true,
      financeProfile: {
        select: {
          id: true,
          status: true,
          isOnboardingCompleted: true,
          onboardingCompletedAt: true,
          lastAsaasSyncAt: true,
          asaasAccount: {
            select: {
              status: true,
              asaasAccountId: true,
              apiKeyStatus: true,
              operationalStatus: true,
            },
          },
        },
      },
    },
  });

  const profile = conta?.financeProfile;
  const account = profile?.asaasAccount;
  const isApproved =
    conta?.financeStatus === 'FINANCE_APPROVED' &&
    profile?.status === 'APPROVED' &&
    profile.isOnboardingCompleted &&
    account?.status === 'APPROVED' &&
    Boolean(account.asaasAccountId) &&
    account.apiKeyStatus === 'CONNECTED' &&
    account.operationalStatus === 'OPERATIONAL';

  if (!conta || !profile || !account || !isApproved) return null;

  return {
    onboarding: {
      financeProfileId: profile.id,
      status: account.status,
      hasSubaccount: true,
      hasAsaasAccountRecord: true,
      financeStatus: conta.financeStatus,
      financeProfile: {
        status: profile.status,
        isOnboardingCompleted: profile.isOnboardingCompleted,
        onboardingCompletedAt: profile.onboardingCompletedAt,
        lastAsaasSyncAt: profile.lastAsaasSyncAt,
      },
    },
    asaasConnection: { status: 'CONNECTED' },
    myAccountStatus: {
      general: 'APPROVED',
      documentation: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      commercialInfo: 'APPROVED',
    },
    documents: { data: [], rejectReasons: [] },
    documentsRequired: false,
  };
}

export async function guardFinancialAccountOr412(
  contaId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<GateResult> {
  if (!opts.bypassCache) {
    const cached = approvedGateCache.get(contaId);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, summary: cached.summary };
    }
  }

  if (!opts.bypassCache && isLocalMockFinancialGateEnabled()) {
    const mockSummary = await getLocalMockApprovedSummary(contaId);
    if (mockSummary) {
      approvedGateCache.set(contaId, {
        expiresAt: Date.now() + APPROVED_GATE_CACHE_TTL_MS,
        summary: mockSummary,
      });
      return { ok: true, summary: mockSummary };
    }
  }

  const summary = opts.bypassCache ? await getKycSummaryFresh(contaId) : await getKycSummary(contaId);

  if (summary.asaasConnection.status === 'CONNECTED') {
    // Cobranças exigem a aprovação geral/documental, API key e webhook ativo.
    // bankAccountInfo é uma capacidade separada do Asaas e não impede a criação
    // de cobranças; transferências/liquidações podem aplicar uma regra própria.
    const kyc = await requireKycSnapshotApproved(contaId, { allowPendingBankAccount: true });
    if (kyc.success) {
      approvedGateCache.set(contaId, {
        expiresAt: Date.now() + APPROVED_GATE_CACHE_TTL_MS,
        summary,
      });
      return { ok: true, summary };
    }

    approvedGateCache.delete(contaId);

    if (kyc.error.code === 'COMMERCIAL_INFO_EXPIRED') {
      return {
        ok: false,
        response: json(412, {
          code: 'COMMERCIAL_INFO_EXPIRED',
          financialAccount: { status: 'PENDING_ACTIVATION' },
          reasons: kyc.error.reasons,
          redirectTo: '/conta/perfil',
        }),
      };
    }

    if (kyc.error.code === 'KYC_REQUIRED') {
      return {
        ok: false,
        response: json(412, {
          code: 'KYC_REQUIRED',
          financialAccount: { status: 'PENDING_ACTIVATION' },
          reasons: kyc.error.reasons,
          redirectTo: '/conta/verificacao',
        }),
      };
    }

    return {
      ok: false,
      response: json(412, {
        code: 'FINANCIAL_ACCOUNT_UNAVAILABLE',
        financialAccount: { status: 'UNAVAILABLE' },
        redirectTo: '/conta/verificacao',
      }),
    };
  }

  approvedGateCache.delete(contaId);

  const payload: FinancialAccountGatePayload =
    summary.asaasConnection.status === 'NOT_CONNECTED'
      ? {
          code: 'FINANCIAL_ACCOUNT_NOT_READY',
          financialAccount: { status: 'PENDING_ACTIVATION' },
          reasons:
            summary.asaasConnection.reasonCode === 'CREDENTIAL_DECRYPTION_FAILED'
              ? ['A credencial Asaas armazenada não pôde ser validada. Reconecte a conta financeira.']
              : ['A conta financeira ainda não possui uma credencial Asaas válida.'],
        }
      : { code: 'FINANCIAL_ACCOUNT_UNAVAILABLE', financialAccount: { status: 'UNAVAILABLE' } };

  return { ok: false, response: json(412, payload) };
}
