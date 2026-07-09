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
} from '@alusa/stripe';
import type { PlatformPlanCode, PublicPlatformPlanCode } from './plans';

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
  lastReconciledAt: Date | null;
  pendingPlanCode: PlatformPlanCode | null;
  pendingChangeType: PlatformBillingPlanChangeType | null;
  pendingChangeEffectiveAt: Date | null;
}

export interface PlatformBillingCheckoutSessionRecord {
  id: string;
  contaId: string;
  billingAccountId: string;
  environment: PlatformBillingEnvironment;
  planCode: PublicPlatformPlanCode;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  status: PlatformBillingCheckoutSessionStatus;
  url: string | null;
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
  planCode: PublicPlatformPlanCode;
  stripePriceId: string;
  pendingChangeType?: PlatformBillingPlanChangeType | null;
}

export interface CreatePlatformBillingCheckoutSessionRecordInput {
  contaId: string;
  billingAccountId: string;
  environment: PlatformBillingEnvironment;
  planCode: PublicPlatformPlanCode;
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
  status: PlatformBillingAccountStatus;
  planCode: PlatformPlanCode | null;
  stripeSubscriptionId: string;
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
  trialWillEndNotifiedAt?: Date | null;
  pendingPlanCode?: PlatformPlanCode | null;
  pendingChangeType?: PlatformBillingPlanChangeType | null;
  pendingChangeEffectiveAt?: Date | null;
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
  markCheckoutPending(_input: MarkPlatformBillingCheckoutPendingInput): Promise<PlatformBillingAccountRecord>;
  updateAccountFromStripeSubscription(
    _input: UpdatePlatformBillingAccountFromStripeSubscriptionInput,
  ): Promise<PlatformBillingAccountRecord>;
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
  markWebhookEventProcessed(_input: { id: string; contaId?: string }): Promise<PlatformBillingWebhookEventRecord>;
  markWebhookEventIgnored(_input: { id: string; contaId?: string }): Promise<PlatformBillingWebhookEventRecord>;
  markWebhookEventFailed(_input: {
    id: string;
    contaId?: string;
    error: string;
    errorCode?: string;
    nextAttemptAt?: Date;
    exhausted?: boolean;
  }): Promise<PlatformBillingWebhookEventRecord>;
  createAuditLog(_input: PlatformBillingAuditLogInput): Promise<void>;
}

export interface PlatformBillingStripeGateway {
  createCustomer(_input: CreateStripeBillingCustomerInput): Promise<StripeBillingCustomerResult>;
  createCheckoutSession(
    _input: CreateStripeSubscriptionCheckoutSessionInput,
  ): Promise<StripeSubscriptionCheckoutSessionResult>;
  createTrialSubscriptionWithoutPaymentMethod(
    _input: CreateStripeTrialSubscriptionWithoutPaymentMethodInput,
  ): Promise<StripeSubscriptionRecord>;
  createPortalSession(_input: CreateStripeBillingPortalSessionInput): Promise<StripeBillingPortalSessionResult>;
  retrieveSubscription(_subscriptionId: string): Promise<StripeSubscriptionRecord>;
  previewSubscriptionPlanChange(
    _input: PreviewStripeSubscriptionPlanChangeInput,
  ): Promise<StripeSubscriptionPlanChangePreview>;
  updateSubscriptionPlan(_input: UpdateStripeSubscriptionPlanInput): Promise<StripeSubscriptionRecord>;
  updateSubscriptionCancelAtPeriodEnd(_input: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<StripeSubscriptionRecord>;
}
