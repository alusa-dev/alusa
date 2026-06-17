export type ExternalAsaasApiKeyHealthInput = {
  role?: string | null;
  financeIntegrationMode?: string | null;
  externalAsaasOnboardingStatus?: string | null;
  asaasApiKeyStatus?: string | null;
};

const CONNECTED_ONBOARDING_STATUSES = new Set(['READY', 'WEBHOOK_PENDING']);

export function isExternalAsaasApiKeyHealthy(
  user: ExternalAsaasApiKeyHealthInput | null | undefined,
): boolean {
  if (user?.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
    return true;
  }

  const onboardingStatus = user.externalAsaasOnboardingStatus ?? 'NOT_STARTED';
  const apiKeyStatus = user.asaasApiKeyStatus ?? 'MISSING';

  return CONNECTED_ONBOARDING_STATUSES.has(onboardingStatus) && apiKeyStatus === 'CONNECTED';
}

export function shouldShowExternalAsaasApiKeyModal(
  user: ExternalAsaasApiKeyHealthInput | null | undefined,
): boolean {
  if (!user) return false;

  const role = user.role?.toUpperCase() ?? '';
  const isAllowedRole = role === 'ADMIN' || role === 'FINANCEIRO';
  const isExternalMode = user.financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';

  if (!isAllowedRole || !isExternalMode) return false;

  return !isExternalAsaasApiKeyHealthy(user);
}
