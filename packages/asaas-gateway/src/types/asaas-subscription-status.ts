/**
 * Status de Subscription do Asaas
 * Fonte: https://docs.asaas.com/docs/eventos-para-assinaturas
 */
export const ASAAS_SUBSCRIPTION_STATUS = {
  /** Ativa */
  ACTIVE: 'ACTIVE',
  /** Inativa */
  INACTIVE: 'INACTIVE',
  /** Expirada */
  EXPIRED: 'EXPIRED',
} as const;

export type AsaasSubscriptionStatus = (typeof ASAAS_SUBSCRIPTION_STATUS)[keyof typeof ASAAS_SUBSCRIPTION_STATUS];

/**
 * Ciclo de cobrança da assinatura
 */
export const ASAAS_SUBSCRIPTION_CYCLE = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  BIMONTHLY: 'BIMONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMIANNUALLY: 'SEMIANNUALLY',
  YEARLY: 'YEARLY',
} as const;

export type AsaasSubscriptionCycle = (typeof ASAAS_SUBSCRIPTION_CYCLE)[keyof typeof ASAAS_SUBSCRIPTION_CYCLE];

/**
 * Verifica se a assinatura está ativa
 */
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === ASAAS_SUBSCRIPTION_STATUS.ACTIVE;
}
