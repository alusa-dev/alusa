export type PlatformBillingErrorCode =
  | 'PLATFORM_PLAN_INVALID'
  | 'PLATFORM_PLAN_NOT_PUBLIC'
  | 'PLATFORM_PRICE_MISSING'
  | 'PLATFORM_PRICE_INVALID'
  | 'PLATFORM_PRICE_UNKNOWN'
  | 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND'
  | 'PLATFORM_BILLING_CUSTOMER_MISSING'
  | 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED'
  | 'PLATFORM_BILLING_INPUT_INVALID'
  | 'PLATFORM_BILLING_WEBHOOK_INVALID'
  | 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED'
  | 'PLATFORM_BILLING_ACCESS_RESTRICTED'
  | 'PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED'
  | 'PLATFORM_BILLING_SUBSCRIPTION_MISSING'
  | 'PLATFORM_BILLING_PLAN_CHANGE_INVALID'
  | 'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE'
  | 'PLATFORM_BILLING_REPLAY_INVALID'
  | 'PLATFORM_BILLING_RECONCILIATION_FAILED';

export class PlatformBillingError extends Error {
  public readonly code: PlatformBillingErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: PlatformBillingErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PlatformBillingError';
    this.code = code;
    this.details = details;
  }
}
