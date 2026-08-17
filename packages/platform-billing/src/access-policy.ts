import { PlatformBillingError } from './errors';
import type { PlatformBillingAccountRecord, PlatformBillingRestrictionReason } from './types';

export type PlatformBillingAccessStatus = 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED';
export type PlatformBillingCommunicationLevel =
  | 'NONE'
  | 'TRIAL_WARNING'
  | 'PAYMENT_PENDING'
  | 'RESTRICTED'
  | 'RENEWED';

export type PlatformBillingCommunication = {
  level: PlatformBillingCommunicationLevel;
  noticeKey: string | null;
};

export type PlatformBillingCapability =
  | 'BILLING_READ'
  | 'BILLING_MANAGE'
  | 'SUPPORT'
  | 'ESSENTIAL_EXPORT'
  | 'ACCOUNT_READ'
  | 'REPORT_READ'
  | 'MONEY_READ'
  | 'MONEY_TRANSFER'
  | 'MONEY_WITHDRAW'
  | 'STUDENT_WRITE'
  | 'RESPONSIBLE_WRITE'
  | 'STAFF_WRITE'
  | 'CLASS_WRITE'
  | 'ROOM_WRITE'
  | 'MODALITY_WRITE'
  | 'LESSON_WRITE'
  | 'STORE_WRITE'
  | 'EVENT_WRITE'
  | 'ENROLLMENT_WRITE'
  | 'CONTRACT_WRITE'
  | 'CHARGE_CREATE'
  | 'FINANCIAL_CONFIG_WRITE'
  | 'ADMIN_WRITE';

export const PLATFORM_BILLING_CAPABILITIES: readonly PlatformBillingCapability[] = [
  'BILLING_READ',
  'BILLING_MANAGE',
  'SUPPORT',
  'ESSENTIAL_EXPORT',
  'ACCOUNT_READ',
  'REPORT_READ',
  'MONEY_READ',
  'MONEY_TRANSFER',
  'MONEY_WITHDRAW',
  'STUDENT_WRITE',
  'RESPONSIBLE_WRITE',
  'STAFF_WRITE',
  'CLASS_WRITE',
  'ROOM_WRITE',
  'MODALITY_WRITE',
  'LESSON_WRITE',
  'STORE_WRITE',
  'EVENT_WRITE',
  'ENROLLMENT_WRITE',
  'CONTRACT_WRITE',
  'CHARGE_CREATE',
  'FINANCIAL_CONFIG_WRITE',
  'ADMIN_WRITE',
];

export const DEFAULT_PLATFORM_BILLING_GRACE_PERIOD_DAYS = 7;

const RESTRICTED_ALLOWED_CAPABILITIES = new Set<PlatformBillingCapability>([
  'BILLING_READ',
  'BILLING_MANAGE',
  'SUPPORT',
  'ESSENTIAL_EXPORT',
  'ACCOUNT_READ',
  'REPORT_READ',
  'MONEY_READ',
  'MONEY_TRANSFER',
  'MONEY_WITHDRAW',
]);

export function computeGracePeriodEnd(input: { failedAt: Date; gracePeriodDays?: number }): Date {
  const gracePeriodDays = input.gracePeriodDays ?? DEFAULT_PLATFORM_BILLING_GRACE_PERIOD_DAYS;
  return new Date(input.failedAt.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
}

export function derivePlatformAccessStatus(input: {
  account: Pick<
    PlatformBillingAccountRecord,
    | 'status'
    | 'accessStatus'
    | 'cancelAtPeriodEnd'
    | 'currentPeriodEnd'
    | 'gracePeriodEndsAt'
    | 'trialEndsAt'
    | 'firstPaidAt'
    | 'lastSuccessfulPaymentAt'
    | 'paymentMethodStatus'
  > | null;
  /**
   * Required to distinguish an expired trial that was never converted into a
   * paid subscription from an already paid subscription that retains Stripe's
   * historical trial_end value.
   */
  hasUsablePaymentMethod?: boolean;
  now?: Date;
}): PlatformBillingAccessStatus {
  const account = input.account;
  if (!account) return 'PENDING';

  const now = input.now ?? new Date();
  const trialExpired = Boolean(account.trialEndsAt && account.trialEndsAt.getTime() <= now.getTime());
  const hasPaidHistory = Boolean(account.firstPaidAt || account.lastSuccessfulPaymentAt);
  const paymentMethodStatus = input.hasUsablePaymentMethod === undefined
    ? account.paymentMethodStatus
    : input.hasUsablePaymentMethod
      ? 'PRESENT'
      : 'MISSING';

  if (account.status === 'CANCELED' || account.status === 'INCOMPLETE_EXPIRED') {
    return account.cancelAtPeriodEnd && account.currentPeriodEnd && account.currentPeriodEnd > now ? 'ACTIVE' : 'CANCELED';
  }
  if (account.status === 'PAUSED' || account.status === 'UNPAID' || account.status === 'INCOMPLETE') return 'RESTRICTED';
  if (account.status === 'TRIALING') {
    return trialExpired && !hasPaidHistory ? 'RESTRICTED' : 'ACTIVE';
  }
  if (account.status === 'PAST_DUE') {
    const graceActive = Boolean(
      hasPaidHistory &&
      paymentMethodStatus === 'PRESENT' &&
      account.gracePeriodEndsAt &&
      account.gracePeriodEndsAt.getTime() > now.getTime(),
    );
    return graceActive ? 'GRACE_PERIOD' : 'RESTRICTED';
  }
  if (account.status === 'ACTIVE') {
    // A historical trial_end is harmless only after a paid conversion. A
    // card alone does not convert a trial into a paid subscription.
    if (trialExpired && !hasPaidHistory) return 'RESTRICTED';
    return 'ACTIVE';
  }

  return account.accessStatus === 'ACTIVE' ? 'PENDING' : account.accessStatus ?? 'PENDING';
}

export function derivePlatformRestrictionReason(input: {
  account: Pick<
    PlatformBillingAccountRecord,
    | 'status'
    | 'trialEndsAt'
    | 'firstPaidAt'
    | 'lastSuccessfulPaymentAt'
    | 'paymentMethodStatus'
    | 'gracePeriodEndsAt'
    | 'cancelAtPeriodEnd'
    | 'currentPeriodEnd'
  > | null;
  now?: Date;
}): PlatformBillingRestrictionReason | null {
  const account = input.account;
  if (!account) return null;
  const now = input.now ?? new Date();
  const trialExpired = Boolean(account.trialEndsAt && account.trialEndsAt <= now);
  const hasPaidHistory = Boolean(account.firstPaidAt || account.lastSuccessfulPaymentAt);

  if (account.status === 'TRIALING' && trialExpired && !hasPaidHistory) return 'TRIAL_EXPIRED';
  if (account.status === 'ACTIVE' && trialExpired && !hasPaidHistory) return 'TRIAL_EXPIRED';
  if (account.status === 'PAST_DUE') {
    if (account.paymentMethodStatus === 'MISSING') return 'PAYMENT_METHOD_MISSING';
    if (!account.gracePeriodEndsAt || account.gracePeriodEndsAt <= now) return 'PAYMENT_PAST_DUE';
    return null;
  }
  if (account.status === 'UNPAID') return 'PAYMENT_UNPAID';
  if (account.status === 'PAUSED') return 'SUBSCRIPTION_PAUSED';
  if ((account.status === 'CANCELED' || account.status === 'INCOMPLETE_EXPIRED') &&
      !(account.cancelAtPeriodEnd && account.currentPeriodEnd && account.currentPeriodEnd > now)) {
    return 'SUBSCRIPTION_CANCELED';
  }
  return null;
}

export function derivePlatformBillingCommunication(input: {
  account: Pick<
    PlatformBillingAccountRecord,
    | 'status'
    | 'accessStatus'
    | 'cancelAtPeriodEnd'
    | 'currentPeriodEnd'
    | 'trialEndsAt'
    | 'firstPaidAt'
    | 'lastSuccessfulPaymentAt'
    | 'paymentMethodStatus'
    | 'gracePeriodEndsAt'
  > | null;
  now?: Date;
}): PlatformBillingCommunication {
  const account = input.account;
  const now = input.now ?? new Date();
  const accessStatus = derivePlatformAccessStatus({ account, now });
  const restrictionReason = derivePlatformRestrictionReason({ account, now });

  if (accessStatus === 'RESTRICTED' || accessStatus === 'CANCELED') {
    return {
      level: 'RESTRICTED',
      noticeKey: `restricted-${restrictionReason ?? accessStatus}`,
    };
  }

  if (accessStatus === 'GRACE_PERIOD') {
    return {
      level: 'PAYMENT_PENDING',
      noticeKey: `payment-pending-${account?.gracePeriodEndsAt?.toISOString() ?? 'unknown'}`,
    };
  }

  const trialDays = account?.trialEndsAt
    ? Math.ceil((account.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const hasPaidHistory = Boolean(account?.firstPaidAt || account?.lastSuccessfulPaymentAt);
  if (
    account?.paymentMethodStatus !== 'PRESENT' &&
    !hasPaidHistory &&
    trialDays !== null &&
    [1, 3, 7].includes(trialDays)
  ) {
    return { level: 'TRIAL_WARNING', noticeKey: `trial-${trialDays}` };
  }

  const lastSuccessfulPaymentAt = account?.lastSuccessfulPaymentAt;
  const paymentAge = lastSuccessfulPaymentAt
    ? now.getTime() - lastSuccessfulPaymentAt.getTime()
    : null;
  if (
    accessStatus === 'ACTIVE' &&
    lastSuccessfulPaymentAt &&
    paymentAge !== null &&
    paymentAge >= 0 &&
    paymentAge <= 24 * 60 * 60 * 1000
  ) {
    return {
      level: 'RENEWED',
      noticeKey: `renewed-${lastSuccessfulPaymentAt.toISOString()}`,
    };
  }

  return { level: 'NONE', noticeKey: null };
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
      restrictionReason: input.account?.restrictionReason ?? null,
      gracePeriodEndsAt: input.account?.gracePeriodEndsAt?.toISOString() ?? null,
    },
  );
}
