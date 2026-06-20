import { NextResponse } from 'next/server';

import {
  getKycSummary,
  getKycSummaryFresh,
  requireKycSnapshotApproved,
  type GetKycSummaryResult,
} from '@alusa/finance';

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

  const summary = opts.bypassCache ? await getKycSummaryFresh(contaId) : await getKycSummary(contaId);

  if (summary.asaasConnection.status === 'CONNECTED') {
    const kyc = await requireKycSnapshotApproved(contaId);
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
      ? { code: 'FINANCIAL_ACCOUNT_NOT_READY', financialAccount: { status: 'PENDING_ACTIVATION' } }
      : { code: 'FINANCIAL_ACCOUNT_UNAVAILABLE', financialAccount: { status: 'UNAVAILABLE' } };

  return { ok: false, response: json(412, payload) };
}
