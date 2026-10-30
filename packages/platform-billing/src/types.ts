import type {
  CreateStripeBillingCustomerInput,
  CreateStripeBillingPortalSessionInput,
  CreateStripeSubscriptionCheckoutSessionInput,
  CreateStripeTrialSubscriptionWithoutPaymentMethodInput,
  PreviewStripeSubscriptionPlanChangeInput,
  StripeSubscriptionPlanChangePreview,
  StripeBillingCustomerResult,
  StripeBillingPortalSessionResult,
  StripeSubscriptionRecord,
  StripeEnvironment,
  UpdateStripeSubscriptionPlanInput,
  StripeSubscriptionCheckoutSessionResult,
  ScheduleStripeSubscriptionPlanChangeInput,
} from '@alusa/stripe';
import type { PlatformPlanCode } from './plans';

export type PlatformBillingEnvironment = StripeEnvironment;

export type PlatformBillingAccountStatus =
  | 'NOT_STARTED'
  | 'CHECKOUT_PENDING'
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'UNPAID'
  | 'PAUSED'
  | 'UNKNOWN';

export type PlatformBillingCheckoutSessionStatus = 'CREATED' | 'COMPLETED' | 'EXPIRED';
export type PlatformBillingInvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE' | 'UNKNOWN';
export type PlatformBillingWebhookEventStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'FAILED'
  | 'EXHAUSTED'
  | 'IGNORED';

export type PlatformBillingAccessStatus = 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED';
export type PlatformBillingPaymentMethodStatus = 'MISSING' | 'PRESENT' | 'UNKNOWN';
export type PlatformBillingRestrictionReason =
  | 'TRIAL_EXPIRED'
  | 'FIRST_PAYMENT_INCOMPLETE'
  | 'PAYMENT_PAST_DUE'
  | 'PAYMENT_UNPAID'
  | 'SUBSCRIPTION_PAUSED'
  | 'SUBSCRIPTION_CANCELED'
  | 'PAYMENT_METHOD_MISSING'
  | 'UNKNOWN';
export type PlatformBillingPlanChangeType =
  | 'UPGRADE'
  | 'DOWNGRADE'
  | 'CANCEL_AT_PERIOD_END'
  | 'UNDO_CANCEL'
  | 'REACTIVATE'
  | 'PAYMENT_RECOVERY';
export type PlatformBillingPlanChangeStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_EFFECTIVE_DATE'
  | 'APPLIED'
  | 'CANCELED'
  | 'FAILED'
  | 'SUPERSEDED';
export type PlatformBillingIssueSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type PlatformBillingIssueStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface PlatformBillingAccountRecord {
  id: string;
  contaId: string;
  environment: PlatformBillingEnvironment;
  status: PlatformBillingAccountStatus;
  planCode: PlatformPlanCode | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialWillEndNotifiedAt: Date | null;
  accessStatus: PlatformBillingAccessStatus;
  gracePeriodEndsAt: Date | null;
  restrictedAt: Date | null;
  canceledAt: Date | null;
  lastPaymentFailedAt: Date | null;
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
  paymentMethodStatus: PlatformBillingPaymentMethodStatus;
  paymentMethodType: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodExpMonth: number | null;
  paymentMethodExpYear: number | null;
  restrictionReason: PlatformBillingRestrictionReason | null;
  gracePeriodStartedAt: Date | null;
  accessStateVersion: number;
  lastProviderEventCreatedAt: Date | null;
  lastStripeEventId?: string | null;
  lastReconciledAt: Date | null;
  pendingPlanCode: PlatformPlanCode | null;
  pendingChangeType: PlatformBillingPlanChangeType | null;
  pendingChangeEffectiveAt: Date | null;
  checkoutClaimKey?: string | null;
  checkoutClaimPhase?: string | null;
  checkoutClaimedAt?: Date | null;
  checkoutRequestExpiresAt?: Date | null;
  trialSubscriptionClaimKey?: string | null;
  trialSubscriptionClaimPhase?: string | null;
  trialSubscriptionClaimedAt?: Date | null;
  trialSubscriptionRequestExpiresAt?: Date | null;
  pendingChangeOperationId: string | null;
  pendingChangeClaimToken?: string | null;
}

export interface PlatformBillingCheckoutSessionRecord {
  id: string;
  contaId: string;
  billingAccountId: string;
  environment: PlatformBillingEnvironment;
  planCode: PlatformPlanCode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  status: PlatformBillingCheckoutSessionStatus;
  url: string | null;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface PlatformBillingInvoiceRecord {
  id: string;
  contaId: string;
  billingAccountId: string | null;
  environment: PlatformBillingEnvironment;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  planCode: PlatformPlanCode | null;
  number: string | null;
  status: PlatformBillingInvoiceStatus;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  attempted: boolean;
  attemptCount: number;
  nextPaymentAttempt: Date | null;
  lastPaymentErrorCode: string | null;
  lastPaymentErrorMessage: string | null;
}

export interface PlatformBillingWebhookEventRecord {
  id: string;
  environment: PlatformBillingEnvironment;
  eventId: string;
  eventType: string;
  contaId: string | null;
  status: PlatformBillingWebhookEventStatus;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  nextAttemptAt: Date | null;
  lockedAt: Date | null;
  lastAttemptAt: Date | null;
  processingTimeoutAt: Date | null;
  processedAt: Date | null;
  exhaustedAt: Date | null;
  workerId: string | null;
  correlationId: string | null;
}

export interface PlatformBillingAuditLogInput {
  contaId: string;
  billingAccountId?: string;
  actorUserId?: string;
  action: string;
  webhookEnvironment?: PlatformBillingEnvironment;
  webhookEventId?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePlatformBillingAccountInput {
  contaId: string;
  environment: PlatformBillingEnvironment;
  stripeCustomerId: string;
}

export interface AttachPlatformBillingCustomerInput {
  accountId: string;
  stripeCustomerId: string;
}

export interface MarkPlatformBillingCheckoutPendingInput {
  accountId: string;
  planCode: PlatformPlanCode;
  stripePriceId: string;
  pendingChangeType?: PlatformBillingPlanChangeType | null;
  idempotencyKey: string;
}

export interface CreatePlatformBillingCheckoutSessionRecordInput {
  contaId: string;
  billingAccountId: string;
  environment: PlatformBillingEnvironment;
  planCode: PlatformPlanCode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  url: string | null;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  createdByUserId?: string;
  expiresAt: Date | null;
}

export interface UpdatePlatformBillingAccountFromStripeSubscriptionInput {
  accountId: string;
  planChangeFinalization?: {
    planChangeId: string;
    contaId: string;
    billingAccountId: string;
    environment: PlatformBillingEnvironment;
    stripeSubscriptionId: string;
    stripePriceId: string;
    toPlanCode: PlatformPlanCode;
    type: 'UPGRADE' | 'DOWNGRADE';
    applied: boolean;
  };
  expectedAccountSnapshot?: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    stripeSubscriptionId: string | null;
    pendingChangeOperationId: string | null;
    pendingChangeClaimToken: string | null;
    trialSubscriptionClaimKey?: string | null;
    lastProviderEventCreatedAt?: Date | null;
    lastStripeEventId?: string | null;
  };
  status: PlatformBillingAccountStatus;
  planCode: PlatformPlanCode | null;
  stripeSubscriptionId: string;
  webhookLease?: { id: string; workerId: string };
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  lastStripeEventId: string;
  accessStatus?: PlatformBillingAccessStatus;
  gracePeriodEndsAt?: Date | null;
  restrictedAt?: Date | null;
  canceledAt?: Date | null;
  lastPaymentFailedAt?: Date | null;
  firstPaidAt?: Date | null;
  lastSuccessfulPaymentAt?: Date | null;
  paymentMethodStatus?: PlatformBillingPaymentMethodStatus;
  paymentMethodType?: string | null;
  paymentMethodBrand?: string | null;
  paymentMethodLast4?: string | null;
  paymentMethodExpMonth?: number | null;
  paymentMethodExpYear?: number | null;
  restrictionReason?: PlatformBillingRestrictionReason | null;
  gracePeriodStartedAt?: Date | null;
  lastProviderEventCreatedAt?: Date | null;
  trialWillEndNotifiedAt?: Date | null;
  pendingPlanCode?: PlatformPlanCode | null;
  pendingChangeType?: PlatformBillingPlanChangeType | null;
  pendingChangeEffectiveAt?: Date | null;
  pendingChangeOperationId?: string | null;
}

export interface UpsertPlatformBillingInvoiceInput {
  contaId: string;
  billingAccountId?: string;
  environment: PlatformBillingEnvironment;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  planCode?: PlatformPlanCode;
  number?: string;
  status: PlatformBillingInvoiceStatus;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
  periodStart?: Date;
  periodEnd?: Date;
  dueDate?: Date;
  paidAt?: Date;
  failedAt?: Date | null;
  attempted?: boolean;
  attemptCount?: number;
  nextPaymentAttempt?: Date | null;
  lastPaymentErrorCode?: string | null;
  lastPaymentErrorMessage?: string | null;
  raw?: Record<string, unknown>;
  lastStripeEventId: string;
}

export interface UpsertPlatformBillingWebhookEventInput {
  environment: PlatformBillingEnvironment;
  eventId: string;
  eventType: string;
  contaId?: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export interface PlatformBillingStore {
  contaExists(_input: { contaId: string }): Promise<boolean>;
  findAccount(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
  }): Promise<PlatformBillingAccountRecord | null>;
  findAccountByStripeCustomerId(_input: {
    environment: PlatformBillingEnvironment;
    stripeCustomerId: string;
  }): Promise<PlatformBillingAccountRecord | null>;
  findAccountByStripeSubscriptionId(_input: {
    environment: PlatformBillingEnvironment;
    stripeSubscriptionId: string;
  }): Promise<PlatformBillingAccountRecord | null>;
  createAccount(_input: CreatePlatformBillingAccountInput): Promise<PlatformBillingAccountRecord>;
  attachCustomer(_input: AttachPlatformBillingCustomerInput): Promise<PlatformBillingAccountRecord>;
  reserveTrialSubscriptionClaim(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    idempotencyKey: string;
  }): Promise<PlatformBillingAccountRecord>;
  markTrialSubscriptionRequestStarted(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    idempotencyKey: string;
  }): Promise<void>;
  releaseTrialSubscriptionClaim(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    idempotencyKey: string;
  }): Promise<void>;
  markCheckoutPending(_input: MarkPlatformBillingCheckoutPendingInput): Promise<PlatformBillingAccountRecord>;
  markCheckoutRequestStarted(_input: { accountId: string; idempotencyKey: string }): Promise<void>;
  bindCheckoutSubscription(_input: {
    accountId: string;
    contaId: string;
    environment: PlatformBillingEnvironment;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    idempotencyKey: string;
  }): Promise<void>;
  clearCheckoutClaim(_input: { contaId: string; environment: PlatformBillingEnvironment; idempotencyKey: string }): Promise<boolean>;
  markCheckoutSessionExpired(_input: { contaId: string; environment: PlatformBillingEnvironment; idempotencyKey: string }): Promise<void>;
  markCheckoutSessionCompleted(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    stripeCheckoutSessionId: string;
  }): Promise<void>;
  updateAccountFromStripeSubscription(
    _input: UpdatePlatformBillingAccountFromStripeSubscriptionInput,
  ): Promise<PlatformBillingAccountRecord>;
  resolveOpenIssuesForPaidAccount?(_input: {
    contaId: string;
    billingAccountId: string;
    environment: PlatformBillingEnvironment;
    correlationId?: string;
  }): Promise<number>;
  findCheckoutSessionByIdempotencyKey(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    idempotencyKey: string;
  }): Promise<PlatformBillingCheckoutSessionRecord | null>;
  createCheckoutSession(
    _input: CreatePlatformBillingCheckoutSessionRecordInput,
  ): Promise<PlatformBillingCheckoutSessionRecord>;
  listInvoices(_input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    limit?: number;
  }): Promise<PlatformBillingInvoiceRecord[]>;
  upsertInvoice(_input: UpsertPlatformBillingInvoiceInput): Promise<PlatformBillingInvoiceRecord>;
  upsertWebhookEvent(_input: UpsertPlatformBillingWebhookEventInput): Promise<{
    record: PlatformBillingWebhookEventRecord;
    inserted: boolean;
  }>;
  markWebhookEventProcessing(_input: {
    id: string;
    contaId?: string;
    workerId?: string;
    processingTimeoutAt?: Date;
  }): Promise<PlatformBillingWebhookEventRecord>;
  markWebhookEventProcessed(_input: { id: string; contaId?: string; workerId?: string }): Promise<PlatformBillingWebhookEventRecord>;
  markWebhookEventIgnored(_input: { id: string; contaId?: string; workerId?: string }): Promise<PlatformBillingWebhookEventRecord>;
  markWebhookEventFailed(_input: {
    id: string;
    contaId?: string;
    error: string;
    errorCode?: string;
    nextAttemptAt?: Date;
    exhausted?: boolean;
    workerId?: string;
  }): Promise<PlatformBillingWebhookEventRecord>;
  createAuditLog(_input: PlatformBillingAuditLogInput): Promise<void>;
}

export interface PlatformBillingStripeGateway {
  listCustomerSubscriptions(_customerId: string): Promise<{
    subscriptions: Array<{
      id: string;
      customerId: string | null;
      status: string;
      livemode: boolean;
      metadata: Record<string, string>;
      priceIds: string[];
    }>;
    complete: boolean;
  }>;
  cancelSubscription(_subscriptionId: string, _idempotencyKey: string): Promise<void>;
  retrieveCheckoutSession(_sessionId: string): Promise<{
    id: string;
    status: string | null;
    livemode: boolean;
    customerId: string | null;
    clientReferenceId: string | null;
    metadata: Record<string, string>;
    priceIds: string[];
    subscriptionId?: string | null;
  }>;
  expireCheckoutSession(_sessionId: string): Promise<void>;
  createCustomer(_input: CreateStripeBillingCustomerInput): Promise<StripeBillingCustomerResult>;
  createCheckoutSession(
    _input: CreateStripeSubscriptionCheckoutSessionInput,
  ): Promise<StripeSubscriptionCheckoutSessionResult>;
  createTrialSubscriptionWithoutPaymentMethod(
    _input: CreateStripeTrialSubscriptionWithoutPaymentMethodInput,
  ): Promise<StripeSubscriptionRecord>;
  createPortalSession(_input: CreateStripeBillingPortalSessionInput): Promise<StripeBillingPortalSessionResult>;
  retrieveSubscription(_subscriptionId: string): Promise<StripeSubscriptionRecord>;
  retrieveSubscriptionSnapshot(_subscriptionId: string): Promise<{
    id: string;
    customerId: string | null;
    status: string;
    livemode: boolean;
    metadata: Record<string, string>;
    priceIds: string[];
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: Date | null;
  }>;
  retrieveLatestSubscriptionInvoice(_subscriptionId: string): Promise<Record<string, unknown> | null>;
  retrieveCustomer(_customerId: string): Promise<{ id: string; deleted: boolean }>;
  previewSubscriptionPlanChange(
    _input: PreviewStripeSubscriptionPlanChangeInput,
  ): Promise<StripeSubscriptionPlanChangePreview>;
  updateSubscriptionPlan(_input: UpdateStripeSubscriptionPlanInput): Promise<StripeSubscriptionRecord>;
  scheduleSubscriptionPlanChange(_input: ScheduleStripeSubscriptionPlanChangeInput): Promise<{ scheduleId: string; effectiveAt: Date }>;
  releaseSubscriptionSchedule(_input: { scheduleId: string; idempotencyKey: string }): Promise<void>;
  updateSubscriptionCancelAtPeriodEnd(_input: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<StripeSubscriptionRecord>;
}
