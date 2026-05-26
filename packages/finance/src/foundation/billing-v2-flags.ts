/**
 * Feature flags para rollout incremental de billing v2.
 * Pertencem à camada de orquestração financeira (@alusa/finance).
 */

export type BillingV2FlagName =
  | 'billing.v2_linking'
  | 'billing.v2_listing'
  | 'billing.v2_notifications'
  | 'billing.v2_balance';

export const BillingV2Flags: Record<BillingV2FlagName, { envKey: string; defaultValue: boolean }> = {
  'billing.v2_linking': {
    envKey: 'BILLING_V2_LINKING_ENABLED',
    defaultValue: false,
  },
  'billing.v2_listing': {
    envKey: 'BILLING_V2_LISTING_ENABLED',
    defaultValue: false,
  },
  'billing.v2_notifications': {
    envKey: 'BILLING_V2_NOTIFICATIONS_ENABLED',
    defaultValue: false,
  },
  'billing.v2_balance': {
    envKey: 'BILLING_V2_BALANCE_ENABLED',
    defaultValue: false,
  },
};

export function isBillingV2FlagEnabled(flagName: BillingV2FlagName): boolean {
  const config = BillingV2Flags[flagName];
  const envValue = process.env[config.envKey];

  if (envValue === undefined || envValue === '') {
    return config.defaultValue;
  }

  return envValue === 'true' || envValue === '1';
}

export function getBillingV2Flags(): Record<BillingV2FlagName, boolean> {
  return {
    'billing.v2_linking': isBillingV2FlagEnabled('billing.v2_linking'),
    'billing.v2_listing': isBillingV2FlagEnabled('billing.v2_listing'),
    'billing.v2_notifications': isBillingV2FlagEnabled('billing.v2_notifications'),
    'billing.v2_balance': isBillingV2FlagEnabled('billing.v2_balance'),
  };
}
