import type { StripeWebhookEvent } from '@alusa/stripe';
import { computeGracePeriodEnd } from './access-policy';
import { PlatformBillingError } from './errors';
import { resolvePlanCodeFromStripePriceId } from './price-mapping';
import type { PlatformPlanCode } from './plans';
import type {
  PlatformBillingAccountStatus,
  PlatformBillingEnvironment,
  PlatformBillingInvoiceStatus,
  PlatformBillingStore,
} from './types';

export interface ProcessPlatformBillingWebhookInput {
  event: StripeWebhookEvent;
  environment: PlatformBillingEnvironment;
  envSource?: Record<string, string | undefined>;
}

export interface ProcessPlatformBillingWebhookResult {
  eventId: string;
  eventType: string;
  status: 'processed' | 'ignored' | 'duplicate';
  contaId: string | null;
}

export interface EnqueuePlatformBillingWebhookResult {
  eventId: string;
  eventType: string;
  status: 'queued' | 'duplicate';
  inboxId: string;
  contaId: string | null;
}

type StripeObject = Record<string, unknown>;

const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.created',
  'invoice.finalized',
  'invoice.updated',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.marked_uncollectible',
  'invoice.voided',
]);

export async function processPlatformBillingWebhookEvent(
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<ProcessPlatformBillingWebhookResult> {
  const persisted = await enqueuePlatformBillingWebhookEvent(input, store);

  if (persisted.status === 'duplicate') {
    return {
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'duplicate',
      contaId: persisted.contaId,
    };
  }

  const eventObject = input.event.data.object as unknown as StripeObject;
  const maybeContaId = readMetadata(eventObject).contaId;
  await store.markWebhookEventProcessing({ id: persisted.inboxId, contaId: maybeContaId });

  try {
    return await processPersistedPlatformBillingWebhookEvent({
      ...input,
      inboxId: persisted.inboxId,
    }, store);
  } catch (error) {
    await store.markWebhookEventFailed({
      id: persisted.inboxId,
      contaId: maybeContaId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof PlatformBillingError ? error.code : undefined,
    });
    throw error;
  }
}

export async function enqueuePlatformBillingWebhookEvent(
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<EnqueuePlatformBillingWebhookResult> {
  const eventObject = input.event.data.object as unknown as StripeObject;
  const maybeContaId = readMetadata(eventObject).contaId;
  const persisted = await store.upsertWebhookEvent({
    environment: input.environment,
    eventId: input.event.id,
    eventType: input.event.type,
    contaId: maybeContaId,
    payload: input.event as unknown as Record<string, unknown>,
    correlationId: input.event.id,
  });

  return {
    eventId: input.event.id,
    eventType: input.event.type,
    status: persisted.inserted ? 'queued' : 'duplicate',
    inboxId: persisted.record.id,
    contaId: persisted.record.contaId,
  };
}

export async function processPersistedPlatformBillingWebhookEvent(
  input: ProcessPlatformBillingWebhookInput & { inboxId: string },
  store: PlatformBillingStore,
): Promise<ProcessPlatformBillingWebhookResult> {
  const eventObject = input.event.data.object as unknown as StripeObject;
  const maybeContaId = readMetadata(eventObject).contaId;

  if (!SUPPORTED_EVENTS.has(input.event.type)) {
    const ignored = await store.markWebhookEventIgnored({ id: input.inboxId, contaId: maybeContaId });
    return {
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'ignored',
      contaId: ignored.contaId,
    };
  }

  let contaId: string | null = maybeContaId ?? null;

  try {
    if (input.event.type === 'checkout.session.completed') {
      contaId = await processCheckoutCompleted(eventObject, input, store);
    } else if (input.event.type.startsWith('customer.subscription.')) {
      contaId = await processSubscriptionEvent(eventObject, input, store);
    } else if (input.event.type.startsWith('invoice.')) {
      contaId = await processInvoiceEvent(eventObject, input, store);
    }

    await store.markWebhookEventProcessed({ id: input.inboxId, contaId: contaId ?? undefined });
    return {
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'processed',
      contaId,
    };
  } catch (error) {
    throw new PlatformBillingError(
      'Platform billing webhook processing failed.',
      'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED',
      { eventType: input.event.type, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function processCheckoutCompleted(
  session: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<string | null> {
  const customerId = readStripeId(session.customer);
  const subscriptionId = readStripeId(session.subscription);
  const metadata = readMetadata(session);
  const contaId = metadata.contaId;

  if (!customerId || !subscriptionId || !contaId) {
    return contaId ?? null;
  }

  const account =
    (await store.findAccountByStripeCustomerId({ environment: input.environment, stripeCustomerId: customerId })) ??
    (await store.createAccount({ contaId, environment: input.environment, stripeCustomerId: customerId }));

  await store.updateAccountFromStripeSubscription({
    accountId: account.id,
    status: session.payment_status === 'paid' ? 'ACTIVE' : 'CHECKOUT_PENDING',
    accessStatus: session.payment_status === 'paid' ? 'ACTIVE' : 'PENDING',
    planCode: session.payment_status === 'paid' ? parsePlanCode(metadata.planCode) ?? account.planCode : account.planCode,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: session.payment_status === 'paid' ? account.stripePriceId : account.stripePriceId,
    currentPeriodEnd: account.currentPeriodEnd,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    trialEndsAt: account.trialEndsAt,
    lastStripeEventId: input.event.id,
    firstPaidAt: session.payment_status === 'paid' ? new Date() : undefined,
    lastSuccessfulPaymentAt: session.payment_status === 'paid' ? new Date() : undefined,
    lastProviderEventCreatedAt: readUnixDate(input.event.created),
  });

  await store.createAuditLog({
    contaId,
    billingAccountId: account.id,
    action: 'PLATFORM_BILLING_CHECKOUT_COMPLETED',
    entityType: 'StripeCheckoutSession',
    entityId: readString(session.id) ?? undefined,
    correlationId: input.event.id,
    metadata: {
      environment: input.environment,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    },
  });

  return contaId;
}

async function processSubscriptionEvent(
  subscription: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<string | null> {
  const subscriptionId = readString(subscription.id);
  const customerId = readStripeId(subscription.customer);
  const priceId = readSubscriptionPriceId(subscription);
  const metadata = readMetadata(subscription);

  if (!subscriptionId || !customerId) return metadata.contaId ?? null;

  let account =
    (await store.findAccountByStripeSubscriptionId({
      environment: input.environment,
      stripeSubscriptionId: subscriptionId,
    })) ??
    (await store.findAccountByStripeCustomerId({
      environment: input.environment,
      stripeCustomerId: customerId,
    }));

  if (!account && metadata.contaId) {
    account = await store.createAccount({
      contaId: metadata.contaId,
      environment: input.environment,
      stripeCustomerId: customerId,
    });
  }

  if (!account) return metadata.contaId ?? null;

  const planCode = priceId ? resolvePlanCodeSafely(priceId, input) : account.planCode;
  const status = mapSubscriptionStatus(readString(subscription.status));
  const paymentMethod = readPaymentMethodFromSubscription(subscription);
  const shouldCommitPlan = shouldCommitPlanFromSubscriptionStatus(status);
  const accountPlanCode = shouldCommitPlan ? planCode : account.planCode;
  const shouldClearPendingPlan = Boolean(shouldCommitPlan && account.pendingPlanCode && planCode === account.pendingPlanCode);
  const isTerminalCancellation = status === 'CANCELED' || status === 'INCOMPLETE_EXPIRED';
  const updated = await store.updateAccountFromStripeSubscription({
    accountId: account.id,
    status,
    accessStatus: mapAccessStatusFromSubscription(status),
    planCode: accountPlanCode,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: shouldCommitPlan ? priceId : account.stripePriceId,
    currentPeriodEnd: readSubscriptionCurrentPeriodEnd(subscription),
    cancelAtPeriodEnd: isTerminalCancellation ? false : subscription.cancel_at_period_end === true,
    trialEndsAt: readUnixDate(subscription.trial_end),
    canceledAt: readUnixDate(subscription.canceled_at),
    restrictedAt: status === 'PAUSED' ? new Date() : null,
    trialWillEndNotifiedAt: input.event.type === 'customer.subscription.trial_will_end' ? new Date() : undefined,
    paymentMethodStatus: paymentMethod.status,
    paymentMethodType: paymentMethod.type,
    paymentMethodBrand: paymentMethod.brand,
    paymentMethodLast4: paymentMethod.last4,
    paymentMethodExpMonth: paymentMethod.expMonth,
    paymentMethodExpYear: paymentMethod.expYear,
    lastProviderEventCreatedAt: readUnixDate(input.event.created),
    pendingPlanCode: shouldClearPendingPlan ? null : undefined,
    pendingChangeType: shouldClearPendingPlan ? null : undefined,
    pendingChangeEffectiveAt: shouldClearPendingPlan ? null : undefined,
    lastStripeEventId: input.event.id,
  });

  await store.createAuditLog({
    contaId: updated.contaId,
    billingAccountId: updated.id,
    action: 'PLATFORM_BILLING_SUBSCRIPTION_SYNCED',
    entityType: 'StripeSubscription',
    entityId: subscriptionId,
    correlationId: input.event.id,
    metadata: {
      environment: input.environment,
      status: updated.status,
      planCode: updated.planCode,
      stripePriceId: updated.stripePriceId,
    },
  });

  return updated.contaId;
}

async function processInvoiceEvent(
  invoice: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<string | null> {
  const invoiceId = readString(invoice.id);
  const customerId = readStripeId(invoice.customer);
  const subscriptionId = readStripeId(invoice.subscription) ?? readNestedString(invoice, ['parent', 'subscription_details', 'subscription']);

  if (!invoiceId || !customerId) return null;

  const account =
    (subscriptionId
      ? await store.findAccountByStripeSubscriptionId({
          environment: input.environment,
          stripeSubscriptionId: subscriptionId,
        })
      : null) ??
    (await store.findAccountByStripeCustomerId({
      environment: input.environment,
      stripeCustomerId: customerId,
    }));

  if (!account) return null;

  const priceId = readInvoicePriceId(invoice) ?? account.stripePriceId;
  const planCode = priceId ? resolvePlanCodeSafely(priceId, input) : account.planCode;
  const isPaymentFailedEvent = input.event.type === 'invoice.payment_failed' || input.event.type === 'invoice.payment_action_required';
  const isPaymentPaidEvent = input.event.type === 'invoice.paid' || input.event.type === 'invoice.payment_succeeded';
  const invoiceFailure = readInvoicePaymentFailure(invoice);
  const nextPaymentAttempt = readUnixDate(invoice.next_payment_attempt);
  const failedAt = isPaymentFailedEvent ? new Date() : isPaymentPaidEvent ? null : undefined;

  const invoiceStatus = mapInvoiceStatus(readString(invoice.status));
  const amountDue = readNumber(invoice.amount_due) ?? 0;
  const amountPaid = readNumber(invoice.amount_paid) ?? 0;
  const attemptCount = readNumber(invoice.attempt_count) ?? 0;

  await store.upsertInvoice({
    contaId: account.contaId,
    billingAccountId: account.id,
    environment: input.environment,
    stripeInvoiceId: invoiceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId ?? undefined,
    stripePriceId: priceId ?? undefined,
    planCode: planCode ?? undefined,
    number: readString(invoice.number) ?? undefined,
    status: invoiceStatus,
    amountDue,
    amountPaid,
    currency: readString(invoice.currency) ?? 'brl',
    hostedInvoiceUrl: readString(invoice.hosted_invoice_url) ?? undefined,
    invoicePdf: readString(invoice.invoice_pdf) ?? undefined,
    periodStart: readUnixDate(invoice.period_start) ?? undefined,
    periodEnd: readUnixDate(invoice.period_end) ?? undefined,
    dueDate: readUnixDate(invoice.due_date) ?? undefined,
    paidAt: readUnixDate(invoice.status_transitions && (invoice.status_transitions as StripeObject).paid_at) ?? undefined,
    failedAt,
    attempted: readBoolean(invoice.attempted) ?? false,
    attemptCount,
    nextPaymentAttempt: isPaymentPaidEvent ? null : nextPaymentAttempt ?? undefined,
    lastPaymentErrorCode: isPaymentPaidEvent ? null : invoiceFailure.code ?? undefined,
    lastPaymentErrorMessage: isPaymentPaidEvent ? null : invoiceFailure.message ?? undefined,
    raw: invoice,
    lastStripeEventId: input.event.id,
  });

  await store.createAuditLog({
    contaId: account.contaId,
    billingAccountId: account.id,
    action: resolveInvoiceAuditAction(input.event.type),
    entityType: 'StripeInvoice',
    entityId: invoiceId,
    correlationId: input.event.id,
    metadata: {
      environment: input.environment,
      eventType: input.event.type,
      status: invoiceStatus,
      amountDue,
      amountPaid,
      attemptCount,
      nextPaymentAttempt: nextPaymentAttempt?.toISOString() ?? null,
      failureCode: invoiceFailure.code,
    },
  });

  const subscriptionToPersist = subscriptionId ?? account.stripeSubscriptionId;
  if (subscriptionToPersist && (isPaymentFailedEvent || isPaymentPaidEvent)) {
    const paymentStateChangedAt = failedAt ?? new Date();
    const graceEligible = isPaymentPaidSubscriptionEligible(account);
    const nextStatus = resolveInvoicePaymentAccountStatus({
      accountStatus: account.status,
      trialEndsAt: account.trialEndsAt,
      isPaymentFailed: isPaymentFailedEvent,
      graceEligible,
    });
    const nextAccessStatus = isPaymentFailedEvent && !graceEligible
      ? 'RESTRICTED'
      : mapAccessStatusFromSubscription(nextStatus);
    await store.updateAccountFromStripeSubscription({
      accountId: account.id,
      status: nextStatus,
      accessStatus: nextAccessStatus,
      planCode,
      stripeSubscriptionId: subscriptionToPersist,
      stripePriceId: priceId,
      currentPeriodEnd: account.currentPeriodEnd,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      trialEndsAt: account.trialEndsAt,
      gracePeriodEndsAt: isPaymentFailedEvent && graceEligible
        ? computeGracePeriodEnd({ failedAt: paymentStateChangedAt })
        : null,
      restrictedAt: isPaymentFailedEvent && !graceEligible ? paymentStateChangedAt : null,
      lastPaymentFailedAt: isPaymentFailedEvent ? paymentStateChangedAt : null,
      firstPaidAt: isPaymentPaidEvent ? account.firstPaidAt ?? paymentStateChangedAt : undefined,
      lastSuccessfulPaymentAt: isPaymentPaidEvent ? paymentStateChangedAt : undefined,
      restrictionReason: isPaymentFailedEvent && !graceEligible
        ? account.firstPaidAt || account.lastSuccessfulPaymentAt
          ? account.paymentMethodStatus === 'MISSING'
            ? 'PAYMENT_METHOD_MISSING'
            : 'PAYMENT_PAST_DUE'
          : 'FIRST_PAYMENT_INCOMPLETE'
        : null,
      gracePeriodStartedAt: isPaymentFailedEvent && graceEligible ? paymentStateChangedAt : null,
      paymentMethodStatus: isPaymentPaidEvent ? 'PRESENT' : undefined,
      lastProviderEventCreatedAt: readUnixDate(input.event.created),
      pendingChangeType: isPaymentFailedEvent && graceEligible
        ? 'PAYMENT_RECOVERY'
        : account.pendingChangeType === 'PAYMENT_RECOVERY'
          ? null
          : undefined,
      pendingChangeEffectiveAt: isPaymentFailedEvent && graceEligible
        ? nextPaymentAttempt
        : account.pendingChangeType === 'PAYMENT_RECOVERY'
          ? null
          : undefined,
      lastStripeEventId: input.event.id,
    });
  }

  return account.contaId;
}

function resolveInvoicePaymentAccountStatus(input: {
  accountStatus: PlatformBillingAccountStatus;
  trialEndsAt: Date | null;
  isPaymentFailed: boolean;
  graceEligible: boolean;
}): PlatformBillingAccountStatus {
  if (input.isPaymentFailed && input.graceEligible) return 'PAST_DUE';
  if (input.isPaymentFailed) return input.accountStatus;
  if (input.accountStatus === 'CANCELED') return 'CANCELED';
  if (input.trialEndsAt && input.trialEndsAt.getTime() > Date.now()) return 'TRIALING';
  return 'ACTIVE';
}

function isPaymentPaidSubscriptionEligible(account: {
  status: PlatformBillingAccountStatus;
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
  paymentMethodStatus: 'MISSING' | 'PRESENT' | 'UNKNOWN';
}): boolean {
  // Trial accounts never receive the commercial grace period. A failed invoice
  // during/at the end of a trial must be regularized before operational access
  // is restored. ACTIVE/PAST_DUE are states of an already paid subscription.
  return Boolean(
    (account.status === 'ACTIVE' || account.status === 'PAST_DUE') &&
    (account.firstPaidAt || account.lastSuccessfulPaymentAt) &&
    account.paymentMethodStatus === 'PRESENT',
  );
}

function resolveInvoiceAuditAction(eventType: string): string {
  if (eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') {
    return 'PLATFORM_BILLING_PAYMENT_REQUIRES_ATTENTION';
  }
  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded') {
    return 'PLATFORM_BILLING_INVOICE_PAID';
  }
  return 'PLATFORM_BILLING_INVOICE_SYNCED';
}

function mapSubscriptionStatus(status: string | null): PlatformBillingAccountStatus {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'incomplete':
      return 'INCOMPLETE';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    case 'unpaid':
      return 'UNPAID';
    case 'paused':
      return 'PAUSED';
    default:
      return 'UNKNOWN';
  }
}

function mapInvoiceStatus(status: string | null): PlatformBillingInvoiceStatus {
  switch (status) {
    case 'draft':
      return 'DRAFT';
    case 'open':
      return 'OPEN';
    case 'paid':
      return 'PAID';
    case 'void':
      return 'VOID';
    case 'uncollectible':
      return 'UNCOLLECTIBLE';
    default:
      return 'UNKNOWN';
  }
}

function mapAccessStatusFromSubscription(
  status: PlatformBillingAccountStatus,
): 'PENDING' | 'ACTIVE' | 'GRACE_PERIOD' | 'RESTRICTED' | 'CANCELED' {
  if (status === 'ACTIVE' || status === 'TRIALING') return 'ACTIVE';
  if (status === 'PAST_DUE') return 'GRACE_PERIOD';
  if (status === 'UNPAID' || status === 'PAUSED') return 'RESTRICTED';
  if (status === 'CANCELED' || status === 'INCOMPLETE_EXPIRED') return 'CANCELED';
  return 'PENDING';
}

function shouldCommitPlanFromSubscriptionStatus(status: PlatformBillingAccountStatus): boolean {
  return status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE' || status === 'UNPAID' || status === 'PAUSED';
}

function resolvePlanCodeSafely(
  priceId: string,
  input: ProcessPlatformBillingWebhookInput,
): PlatformPlanCode | null {
  try {
    return resolvePlanCodeFromStripePriceId(priceId, {
      ...input.envSource,
      STRIPE_ENVIRONMENT: input.environment,
    }).planCode;
  } catch {
    return null;
  }
}

function parsePlanCode(value: string | undefined): PlatformPlanCode | null {
  if (value === 'STARTER' || value === 'PREMIUM' || value === 'PRO' || value === 'CUSTOM') return value;
  return null;
}

function readPaymentMethodFromSubscription(subscription: StripeObject): {
  status: 'MISSING' | 'PRESENT' | 'UNKNOWN';
  type?: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
} {
  const raw = subscription.default_payment_method;
  if (raw === null) return { status: 'MISSING' };
  if (!raw) return { status: 'UNKNOWN' };

  const method = readRecord(raw);
  const card = readRecord(method.card);
  return {
    status: 'PRESENT',
    type: readString(method.type) ?? undefined,
    brand: readString(card.brand),
    last4: readString(card.last4),
    expMonth: readNumber(card.exp_month),
    expYear: readNumber(card.exp_year),
  };
}

function readMetadata(value: StripeObject): Record<string, string | undefined> {
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata as Record<string, string | undefined>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readStripeId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value) return readString((value as StripeObject).id);
  return null;
}

function readUnixDate(value: unknown): Date | null {
  const seconds = readNumber(value);
  return seconds ? new Date(seconds * 1000) : null;
}

function readSubscriptionPriceId(subscription: StripeObject): string | null {
  const items = subscription.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  return items?.data?.[0]?.price?.id ?? null;
}

function readSubscriptionCurrentPeriodEnd(subscription: StripeObject): Date | null {
  const items = subscription.items as { data?: Array<{ current_period_end?: number }> } | undefined;
  return readUnixDate(subscription.current_period_end) ?? readUnixDate(items?.data?.[0]?.current_period_end);
}

function readInvoicePriceId(invoice: StripeObject): string | null {
  const lines = invoice.lines as { data?: Array<{ price?: { id?: string } }> } | undefined;
  return lines?.data?.[0]?.price?.id ?? null;
}

function readNestedString(value: StripeObject, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as StripeObject)[key];
  }
  return readString(current);
}

function readInvoicePaymentFailure(invoice: StripeObject): { code: string | null; message: string | null } {
  const candidates = [
    readRecord(invoice.last_payment_error),
    readRecord(readRecord(invoice.payment_intent).last_payment_error),
    readRecord(invoice.last_finalization_error),
  ];

  for (const candidate of candidates) {
    const code = readString(candidate.code) ?? readString(candidate.decline_code);
    const message = readString(candidate.message);
    if (code || message) {
      return {
        code: code ? code.slice(0, 120) : null,
        message: message ? message.slice(0, 500) : null,
      };
    }
  }

  return { code: null, message: null };
}

function readRecord(value: unknown): StripeObject {
  return value && typeof value === 'object' ? value as StripeObject : {};
}
