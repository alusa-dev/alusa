function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function isExternalAsaasOnboardingRolloutEnabled(): boolean {
  return parseBooleanEnv(process.env.FEATURE_EXTERNAL_ASAAS_ONBOARDING);
}