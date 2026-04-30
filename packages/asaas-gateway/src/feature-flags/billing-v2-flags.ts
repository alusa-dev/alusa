/**
 * Feature Flags para Billing v2
 * 
 * Usadas para migração incremental sem quebrar comportamento existente.
 * As flags podem ser habilitadas globalmente via env ou por tenant via banco.
 */

export type BillingV2FlagName =
  | 'billing.v2_linking'       // Linkagem determinística por externalReference
  | 'billing.v2_listing'       // Listagens corretas (assinaturas/parcelamentos)
  | 'billing.v2_notifications' // Notificações via Asaas (WhatsApp/E-mail/SMS)
  | 'billing.v2_balance';      // Balanço e liquidação

/**
 * Configuração centralizada das flags
 */
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

/**
 * Verifica se uma flag está habilitada (via env)
 */
export function isBillingV2FlagEnabled(flagName: BillingV2FlagName): boolean {
  const config = BillingV2Flags[flagName];
  const envValue = process.env[config.envKey];
  
  if (envValue === undefined || envValue === '') {
    return config.defaultValue;
  }
  
  return envValue === 'true' || envValue === '1';
}

/**
 * Retorna todas as flags e seus valores atuais
 */
export function getBillingV2Flags(): Record<BillingV2FlagName, boolean> {
  return {
    'billing.v2_linking': isBillingV2FlagEnabled('billing.v2_linking'),
    'billing.v2_listing': isBillingV2FlagEnabled('billing.v2_listing'),
    'billing.v2_notifications': isBillingV2FlagEnabled('billing.v2_notifications'),
    'billing.v2_balance': isBillingV2FlagEnabled('billing.v2_balance'),
  };
}
