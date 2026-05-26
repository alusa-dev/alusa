import type { SubscriptionStatus } from '@prisma/client';

export const ASAAS_SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  EXPIRED: 'EXPIRED',
} as const;

export type AsaasSubscriptionStatus =
  (typeof ASAAS_SUBSCRIPTION_STATUS)[keyof typeof ASAAS_SUBSCRIPTION_STATUS];

export function mapAsaasSubscriptionStatus(params: {
  status?: string;
  deleted?: boolean;
  event?: string;
}): SubscriptionStatus {
  if (params.deleted || params.event === 'SUBSCRIPTION_DELETED') return 'DELETED';

  switch (params.status) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'INACTIVE':
      return 'INACTIVE';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'FAILED';
  }
}

export function isAsaasSubscriptionActive(status: string | null | undefined): boolean {
  return status === ASAAS_SUBSCRIPTION_STATUS.ACTIVE;
}
