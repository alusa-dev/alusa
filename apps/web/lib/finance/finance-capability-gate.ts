import { NextResponse } from 'next/server';

import { resolveFinancialCapabilities } from './financial-capabilities';

export type FinanceCapability = 'kyc' | 'balance' | 'statement' | 'transfers' | 'anticipations';

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function blockUnavailableFinanceCapability(
  financeIntegrationMode: string | null | undefined,
  capability: FinanceCapability,
) {
  const capabilities = resolveFinancialCapabilities(financeIntegrationMode);

  const allowed =
    (capability === 'kyc' && capabilities.canUseKyc) ||
    (capability === 'balance' && capabilities.canUseAccountBalance) ||
    (capability === 'statement' && capabilities.canUseStatement) ||
    (capability === 'transfers' && capabilities.canUseTransfers) ||
    (capability === 'anticipations' && capabilities.canUseAnticipations);

  if (allowed) {
    return null;
  }

  return json(409, {
    error: 'FINANCE_CAPABILITY_UNAVAILABLE',
    capability,
  });
}