export function isExternalAsaasIntegrationMode(financeIntegrationMode?: string | null): boolean {
  return financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';
}

export function resolveFinancialCapabilities(financeIntegrationMode?: string | null) {
  const isExternal = isExternalAsaasIntegrationMode(financeIntegrationMode);

  return {
    canUseKyc: !isExternal,
    canUseAccountBalance: !isExternal,
    canUseStatement: !isExternal,
    canUseTransfers: !isExternal,
    canUseAnticipations: !isExternal,
    canUseWhitelabelTreasury: !isExternal,
  };
}

export function isWhitelabelTreasuryPath(pathname: string): boolean {
  return (
    pathname === '/account/verification' ||
    pathname.startsWith('/account/verification/') ||
    pathname === '/finance/account' ||
    pathname.startsWith('/finance/account/') ||
    pathname === '/finance/statement' ||
    pathname.startsWith('/finance/statement/') ||
    pathname === '/advances' ||
    pathname.startsWith('/advances/')
  );
}