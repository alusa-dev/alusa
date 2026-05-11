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
    pathname === '/conta/verificacao' ||
    pathname.startsWith('/conta/verificacao/') ||
    pathname === '/financeiro/conta' ||
    pathname.startsWith('/financeiro/conta/') ||
    pathname === '/financeiro/extrato' ||
    pathname.startsWith('/financeiro/extrato/') ||
    pathname === '/antecipacoes' ||
    pathname.startsWith('/antecipacoes/')
  );
}