import { PlatformBillingError } from './errors';
import type { PlatformBillingAccountRecord } from './types';

export type PlatformBillingAccessStatus = 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED';

export type PlatformBillingCapability =
  | 'BILLING_READ'
  | 'BILLING_MANAGE'
  | 'SUPPORT'
  | 'ESSENTIAL_EXPORT'
  | 'STUDENT_WRITE'
  | 'ENROLLMENT_WRITE'
  | 'ADMIN_WRITE';

export const DEFAULT_PLATFORM_BILLING_GRACE_PERIOD_DAYS = 7;

const RESTRICTED_ALLOWED_CAPABILITIES = new Set<PlatformBillingCapability>([
  'BILLING_READ',
  'BILLING_MANAGE',
  'SUPPORT',
  'ESSENTIAL_EXPORT',
]);

export function computeGracePeriodEnd(input: { failedAt: Date; gracePeriodDays?: number }): Date {
  const gracePeriodDays = input.gracePeriodDays ?? DEFAULT_PLATFORM_BILLING_GRACE_PERIOD_DAYS;
  return new Date(input.failedAt.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
}

export function derivePlatformAccessStatus(input: {
  account: Pick<
    PlatformBillingAccountRecord,
    'status' | 'accessStatus' | 'cancelAtPeriodEnd' | 'currentPeriodEnd' | 'gracePeriodEndsAt' | 'trialEndsAt'
  > | null;
  now?: Date;
}): PlatformBillingAccessStatus {
  const account = input.account;
  if (!account) return 'PENDING';

  if (account.status === 'CANCELED' || account.status === 'INCOMPLETE_EXPIRED') return 'CANCELED';
  if (account.status === 'PAUSED') return 'RESTRICTED';
  if (account.status === 'UNPAID') return 'RESTRICTED';
  if (account.status === 'TRIALING' && account.trialEndsAt) {
    return account.trialEndsAt.getTime() <= (input.now ?? new Date()).getTime() ? 'RESTRICTED' : 'ACTIVE';
  }
  if (account.accessStatus === 'GRACE_PERIOD' && account.gracePeriodEndsAt) {
    return account.gracePeriodEndsAt.getTime() <= (input.now ?? new Date()).getTime() ? 'RESTRICTED' : 'GRACE_PERIOD';
  }
  if (account.accessStatus === 'RESTRICTED' || account.accessStatus === 'CANCELED') return account.accessStatus;
  if (account.status === 'ACTIVE' || account.status === 'TRIALING') return 'ACTIVE';
  if (account.status === 'PAST_DUE') return 'GRACE_PERIOD';

  return account.accessStatus ?? 'PENDING';
}

export function canUsePlatformCapability(input: {
  accessStatus: PlatformBillingAccessStatus;
  capability: PlatformBillingCapability;
}): boolean {
  if (input.accessStatus === 'ACTIVE' || input.accessStatus === 'GRACE_PERIOD') return true;
  if (input.accessStatus === 'PENDING') {
    return input.capability === 'BILLING_READ' || input.capability === 'BILLING_MANAGE' || input.capability === 'SUPPORT';
  }
  if (input.accessStatus === 'RESTRICTED') return RESTRICTED_ALLOWED_CAPABILITIES.has(input.capability);

  return input.capability === 'BILLING_READ' || input.capability === 'BILLING_MANAGE' || input.capability === 'SUPPORT';
}

export function assertPlatformAccess(input: {
  contaId: string;
  account: PlatformBillingAccountRecord | null;
  capability: PlatformBillingCapability;
  now?: Date;
}): PlatformBillingAccessStatus {
  const accessStatus = derivePlatformAccessStatus({
    account: input.account,
    now: input.now,
  });

  if (canUsePlatformCapability({ accessStatus, capability: input.capability })) return accessStatus;

  throw new PlatformBillingError(
    'Platform access is restricted by Alusa commercial billing policy.',
    'PLATFORM_BILLING_ACCESS_RESTRICTED',
    {
      contaId: input.contaId,
      accessStatus,
      capability: input.capability,
      planCode: input.account?.planCode ?? null,
      gracePeriodEndsAt: input.account?.gracePeriodEndsAt?.toISOString() ?? null,
    },
  );
}
