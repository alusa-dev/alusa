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
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
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
  const shouldCommitPlan = shouldCommitPlanFromSubscriptionStatus(status);
  const accountPlanCode = shouldCommitPlan ? planCode : account.planCode;
  const shouldClearPendingPlan = Boolean(shouldCommitPlan && account.pendingPlanCode && planCode === account.pendingPlanCode);
  const updated = await store.updateAccountFromStripeSubscription({
    accountId: account.id,
    status,
    accessStatus: mapAccessStatusFromSubscription(status),
    planCode: accountPlanCode,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: shouldCommitPlan ? priceId : account.stripePriceId,
    currentPeriodEnd: readSubscriptionCurrentPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    trialEndsAt: readUnixDate(subscription.trial_end),
    canceledAt: readUnixDate(subscription.canceled_at),
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
    status: mapInvoiceStatus(readString(invoice.status)),
    amountDue: readNumber(invoice.amount_due) ?? 0,
    amountPaid: readNumber(invoice.amount_paid) ?? 0,
    currency: readString(invoice.currency) ?? 'brl',
    hostedInvoiceUrl: readString(invoice.hosted_invoice_url) ?? undefined,
    invoicePdf: readString(invoice.invoice_pdf) ?? undefined,
    periodStart: readUnixDate(invoice.period_start) ?? undefined,
    periodEnd: readUnixDate(invoice.period_end) ?? undefined,
    dueDate: readUnixDate(invoice.due_date) ?? undefined,
    paidAt: readUnixDate(invoice.status_transitions && (invoice.status_transitions as StripeObject).paid_at) ?? undefined,
    raw: invoice,
    lastStripeEventId: input.event.id,
  });

  const subscriptionToPersist = subscriptionId ?? account.stripeSubscriptionId;
  if (subscriptionToPersist && (input.event.type === 'invoice.payment_failed' || input.event.type === 'invoice.paid' || input.event.type === 'invoice.payment_succeeded')) {
    const failedAt = new Date();
    const isPaymentFailed = input.event.type === 'invoice.payment_failed';
    await store.updateAccountFromStripeSubscription({
      accountId: account.id,
      status: isPaymentFailed ? 'PAST_DUE' : account.status === 'CANCELED' ? 'CANCELED' : 'ACTIVE',
      accessStatus: isPaymentFailed ? 'GRACE_PERIOD' : account.status === 'CANCELED' ? 'CANCELED' : 'ACTIVE',
      planCode,
      stripeSubscriptionId: subscriptionToPersist,
      stripePriceId: priceId,
      currentPeriodEnd: account.currentPeriodEnd,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      trialEndsAt: account.trialEndsAt,
      gracePeriodEndsAt: isPaymentFailed ? computeGracePeriodEnd({ failedAt }) : null,
      restrictedAt: isPaymentFailed ? account.restrictedAt : null,
      lastPaymentFailedAt: isPaymentFailed ? failedAt : null,
      lastStripeEventId: input.event.id,
    });
  }

  return account.contaId;
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
  if (status === 'ACTIVE' || status === 'TRIALING' || status === 'PAUSED') return 'ACTIVE';
  if (status === 'PAST_DUE') return 'GRACE_PERIOD';
  if (status === 'UNPAID') return 'RESTRICTED';
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
