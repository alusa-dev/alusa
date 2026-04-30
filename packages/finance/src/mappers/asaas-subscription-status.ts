import type { SubscriptionStatus } from '@prisma/client';

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
