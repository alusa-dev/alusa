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

function json<T>(status: number, body: T) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function guardFinancialAccountOr412(
  contaId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<GateResult> {
  const summary = opts.bypassCache ? await getKycSummaryFresh(contaId) : await getKycSummary(contaId);

  if (summary.asaasConnection.status === 'CONNECTED') {
    return { ok: true, summary };
  }

  const payload: FinancialAccountGatePayload =
    summary.asaasConnection.status === 'NOT_CONNECTED'
      ? { code: 'FINANCIAL_ACCOUNT_NOT_READY', financialAccount: { status: 'PENDING_ACTIVATION' } }
      : { code: 'FINANCIAL_ACCOUNT_UNAVAILABLE', financialAccount: { status: 'UNAVAILABLE' } };

  return { ok: false, response: json(412, payload) };
}
