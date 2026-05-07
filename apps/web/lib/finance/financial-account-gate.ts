import { NextResponse } from 'next/server';

import { getKycSummary, getKycSummaryFresh, type GetKycSummaryResult } from '@alusa/finance';

export type FinancialAccountStatus = 'PENDING_ACTIVATION' | 'UNAVAILABLE';
export type FinancialAccountGateCode = 'FINANCIAL_ACCOUNT_NOT_READY' | 'FINANCIAL_ACCOUNT_UNAVAILABLE';

export type FinancialAccountGatePayload = {
  code: FinancialAccountGateCode;
  financialAccount: { status: FinancialAccountStatus };
};

type GateResult =
  | { ok: true; summary: GetKycSummaryResult }
  | { ok: false; response: NextResponse<FinancialAccountGatePayload> };

const CONNECTED_GATE_CACHE_TTL_MS = 30_000;
const connectedGateCache = new Map<string, { expiresAt: number; summary: GetKycSummaryResult }>();

function json<T>(status: number, body: T) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function guardFinancialAccountOr412(
  contaId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<GateResult> {
  if (!opts.bypassCache) {
    const cached = connectedGateCache.get(contaId);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, summary: cached.summary };
    }
  }

  const summary = opts.bypassCache ? await getKycSummaryFresh(contaId) : await getKycSummary(contaId);

  if (summary.asaasConnection.status === 'CONNECTED') {
    connectedGateCache.set(contaId, {
      expiresAt: Date.now() + CONNECTED_GATE_CACHE_TTL_MS,
      summary,
    });
    return { ok: true, summary };
  }

  connectedGateCache.delete(contaId);

  const payload: FinancialAccountGatePayload =
    summary.asaasConnection.status === 'NOT_CONNECTED'
      ? { code: 'FINANCIAL_ACCOUNT_NOT_READY', financialAccount: { status: 'PENDING_ACTIVATION' } }
      : { code: 'FINANCIAL_ACCOUNT_UNAVAILABLE', financialAccount: { status: 'UNAVAILABLE' } };

  return { ok: false, response: json(412, payload) };
}
