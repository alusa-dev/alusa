/**
 * Literais técnicos de status/ciclo de assinatura Asaas.
 */

export const ASAAS_SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  EXPIRED: 'EXPIRED',
} as const;

export type AsaasSubscriptionStatus =
  (typeof ASAAS_SUBSCRIPTION_STATUS)[keyof typeof ASAAS_SUBSCRIPTION_STATUS];

export const ASAAS_SUBSCRIPTION_CYCLE = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  BIMONTHLY: 'BIMONTHLY',
  QUARTERLY: 'QUARTERLY',
  SEMIANNUALLY: 'SEMIANNUALLY',
  YEARLY: 'YEARLY',
} as const;

export type AsaasSubscriptionCycle =
  (typeof ASAAS_SUBSCRIPTION_CYCLE)[keyof typeof ASAAS_SUBSCRIPTION_CYCLE];

/**
 * @deprecated Use `isAsaasSubscriptionActive` de `@alusa/finance`.
 */
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === ASAAS_SUBSCRIPTION_STATUS.ACTIVE;
}
