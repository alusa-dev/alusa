import type { StripeWebhookEvent } from '@alusa/stripe';
import { createDefaultPlatformBillingStripeGateway } from './stripe-gateway';
import { computeGracePeriodEnd } from './access-policy';
import { PlatformBillingError } from './errors';
import { resolvePlanCodeFromStripePriceId, resolveStripePriceId } from './price-mapping';
import type { PlatformPlanCode } from './plans';
import type {
  PlatformBillingAccountRecord,
  PlatformBillingAccountStatus,
  PlatformBillingEnvironment,
  PlatformBillingInvoiceStatus,
  PlatformBillingStore,
  PlatformBillingStripeGateway,
} from './types';

export interface ProcessPlatformBillingWebhookInput {
  event: StripeWebhookEvent;
  environment: PlatformBillingEnvironment;
  envSource?: Record<string, string | undefined>;
  stripeGateway?: Pick<PlatformBillingStripeGateway, 'retrieveSubscription' | 'retrieveSubscriptionSnapshot'> &
    Partial<Pick<PlatformBillingStripeGateway, 'retrieveCheckoutSession' | 'retrieveLatestSubscriptionInvoice'>>;
  workerId?: string;
  inboxId?: string;
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

class IgnoredPlatformBillingWebhookEvent extends Error {}

const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'invoice.created',
  'invoice.finalized',
  'invoice.finalization_failed',
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
      workerId: input.workerId,
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
  input: ProcessPlatformBillingWebhookInput & { inboxId: string; deferFinalize?: boolean },
  store: PlatformBillingStore,
): Promise<ProcessPlatformBillingWebhookResult> {
  const eventObject = input.event.data.object as unknown as StripeObject;
  const maybeContaId = readMetadata(eventObject).contaId;

  if (!SUPPORTED_EVENTS.has(input.event.type)) {
    const ignored = await store.markWebhookEventIgnored({ id: input.inboxId, contaId: maybeContaId, workerId: input.workerId });
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
    } else if (input.event.type === 'checkout.session.expired') {
      contaId = await processCheckoutExpired(eventObject, input, store);
    } else if (input.event.type.startsWith('customer.subscription.')) {
      contaId = await processSubscriptionEvent(eventObject, input, store);
    } else if (input.event.type.startsWith('invoice.')) {
      contaId = await processInvoiceEvent(eventObject, input, store);
    }

    if (!input.deferFinalize) {
      await store.markWebhookEventProcessed({ id: input.inboxId, contaId: contaId ?? undefined, workerId: input.workerId });
    }
    return {
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'processed',
      contaId,
    };
  } catch (error) {
    if (error instanceof IgnoredPlatformBillingWebhookEvent) {
      const ignored = await store.markWebhookEventIgnored({ id: input.inboxId, contaId: maybeContaId, workerId: input.workerId });
      return {
        eventId: input.event.id,
        eventType: input.event.type,
        status: 'ignored',
        contaId: ignored.contaId,
      };
    }
    if (error instanceof PlatformBillingError) {
      throw error;
    }
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

  const account = await store.findAccountByStripeCustomerId({ environment: input.environment, stripeCustomerId: customerId });
  if (!account) {
    throw new PlatformBillingError('Checkout customer is not bound to a platform billing account.', 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND');
  }
  if (account.contaId !== contaId) {
    throw new PlatformBillingError('Checkout customer is bound to another Conta.', 'PLATFORM_BILLING_WEBHOOK_INVALID');
  }
  const checkoutRequestKey = readString(metadata.checkoutRequestKey);
  if (checkoutRequestKey) {
    const localCheckout = await store.findCheckoutSessionByIdempotencyKey({
      contaId,
      environment: input.environment,
      idempotencyKey: checkoutRequestKey,
    });
    if (!localCheckout) {
      throw new PlatformBillingError(
        'Completed Checkout has no matching local checkout record yet.',
        'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED',
      );
    }

    const defaultGateway = createDefaultPlatformBillingStripeGateway(input.envSource);
    const gateway = input.stripeGateway ?? defaultGateway;
    const remoteCheckout = await (gateway.retrieveCheckoutSession ?? defaultGateway.retrieveCheckoutSession)(localCheckout.stripeCheckoutSessionId);
    const resolvedPriceId = resolveStripePriceId({
      planCode: localCheckout.planCode,
      environment: input.environment,
      source: input.envSource,
    });
    const checkoutMatches = localCheckout.contaId === contaId &&
      localCheckout.billingAccountId === account.id &&
      localCheckout.environment === input.environment &&
      localCheckout.stripeCheckoutSessionId === readString(session.id) &&
      localCheckout.stripeCustomerId === customerId &&
      localCheckout.idempotencyKey === checkoutRequestKey &&
      readCheckoutCancelRequestKey(localCheckout.cancelUrl) === checkoutRequestKey &&
      (localCheckout.status === 'CREATED' || localCheckout.status === 'COMPLETED') &&
      localCheckout.stripePriceId === resolvedPriceId &&
      remoteCheckout.id === localCheckout.stripeCheckoutSessionId &&
      remoteCheckout.status === 'complete' &&
      remoteCheckout.livemode === (input.environment === 'LIVE') &&
      remoteCheckout.customerId === customerId &&
      remoteCheckout.clientReferenceId === contaId &&
      remoteCheckout.subscriptionId === subscriptionId &&
      remoteCheckout.metadata.contaId === contaId &&
      remoteCheckout.metadata.billingContext === 'platform' &&
      remoteCheckout.metadata.checkoutRequestKey === checkoutRequestKey &&
      remoteCheckout.metadata.planCode === localCheckout.planCode &&
      remoteCheckout.priceIds.length === 1 &&
      remoteCheckout.priceIds[0] === localCheckout.stripePriceId;
    if (!checkoutMatches) {
      throw new PlatformBillingError('Completed Checkout does not match its persisted request.', 'PLATFORM_BILLING_WEBHOOK_INVALID');
    }

    // Stripe is authoritative for Checkout completion. Update the local
    // record only after its tenant, environment, customer, subscription and
    // price bindings have all been verified. The store operation is scoped
    // by tenant/environment/session and is safe to repeat on webhook retries.
    await store.markCheckoutSessionCompleted({
      contaId,
      environment: input.environment,
      stripeCheckoutSessionId: localCheckout.stripeCheckoutSessionId,
    });

    const ownsCurrentAttempt = account.checkoutClaimKey === checkoutRequestKey &&
      account.pendingPlanCode === localCheckout.planCode;
    const alreadyBound = account.stripeSubscriptionId === subscriptionId;
    const isCanceledReactivation = account.status === 'CANCELED' &&
      account.pendingChangeType === 'REACTIVATE' && ownsCurrentAttempt;
    const isNewPendingCheckout = account.status === 'CHECKOUT_PENDING' && ownsCurrentAttempt &&
      !account.stripeSubscriptionId;
    if (!alreadyBound && (!isNewPendingCheckout && !isCanceledReactivation)) {
      // A stale completion must not replace a subscription or consume a newer claim.
      return contaId;
    }

    if (!alreadyBound) {
      await store.bindCheckoutSubscription({
        accountId: account.id,
        contaId,
        environment: input.environment,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        idempotencyKey: checkoutRequestKey,
      });
    }

    const boundAccount = await store.findAccountByStripeSubscriptionId({ environment: input.environment, stripeSubscriptionId: subscriptionId });
    if (!boundAccount || boundAccount.id !== account.id || boundAccount.contaId !== contaId ||
      boundAccount.stripeCustomerId !== customerId || boundAccount.checkoutClaimKey) return contaId;

    const canonicalSubscription = await getCanonicalActiveBoundSubscription({
      subscriptionId,
      customerId,
      account: boundAccount,
      expectedPriceId: localCheckout.stripePriceId,
      environment: input.environment,
      gateway,
    });
    if (canonicalSubscription) {
      const invoice = await (gateway.retrieveLatestSubscriptionInvoice ?? defaultGateway.retrieveLatestSubscriptionInvoice)(subscriptionId);
      if (invoice && isVerifiedPaidCheckoutInvoice({
        invoice,
        account: boundAccount,
        subscriptionId,
        customerId,
        priceId: localCheckout.stripePriceId,
        environment: input.environment,
      })) {
        await processInvoiceEvent(invoice, input, store, { verifiedCanonicalPaidInvoice: true });
      }
    }
  }

  await store.createAuditLog({
    contaId,
    billingAccountId: account.id,
    action: 'PLATFORM_BILLING_CHECKOUT_COMPLETED',
    webhookEnvironment: input.environment,
    webhookEventId: input.event.id,
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

function readCheckoutCancelRequestKey(cancelUrl: string): string | null {
  try {
    const key = new URL(cancelUrl).searchParams.get('checkoutRequestKey');
    return key && key.length <= 128 && key.trim() === key ? key : null;
  } catch {
    return null;
  }
}

async function processCheckoutExpired(
  session: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<string | null> {
  const metadata = readMetadata(session);
  const contaId = metadata.contaId;
  const checkoutRequestKey = readString(metadata.checkoutRequestKey);
  const customerId = readStripeId(session.customer);
  if (!contaId || !checkoutRequestKey || !customerId) return contaId ?? null;
  const account = await store.findAccountByStripeCustomerId({ environment: input.environment, stripeCustomerId: customerId });
  if (!account || account.contaId !== contaId) {
    throw new PlatformBillingError('Expired Checkout customer is not bound to this Conta.', 'PLATFORM_BILLING_WEBHOOK_INVALID');
  }
  await store.clearCheckoutClaim?.({ contaId, environment: input.environment, idempotencyKey: checkoutRequestKey });
  return contaId;
}

async function processSubscriptionEvent(
  subscription: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
): Promise<string | null> {
  const subscriptionId = readString(subscription.id);
  const customerId = readStripeId(subscription.customer);
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
    if (!(await store.contaExists({ contaId: metadata.contaId }))) {
      throw new IgnoredPlatformBillingWebhookEvent('Stripe subscription references a missing Conta.');
    }
    try {
      account = await store.createAccount({
        contaId: metadata.contaId,
        environment: input.environment,
        stripeCustomerId: customerId,
      });
    } catch (error) {
      if (!isForeignKeyConstraintError(error)) throw error;
      try {
        if (!(await store.contaExists({ contaId: metadata.contaId }))) {
          throw new IgnoredPlatformBillingWebhookEvent('Stripe subscription references a Conta removed during account creation.');
        }
      } catch (verificationError) {
        if (verificationError instanceof IgnoredPlatformBillingWebhookEvent) throw verificationError;
        // Preserve the original retryable create error if verification cannot
        // establish that the Conta was removed.
      }
      throw error;
    }
  }

  if (!account) return metadata.contaId ?? null;
  if (metadata.contaId && account.contaId !== metadata.contaId) {
    throw new PlatformBillingError('Stripe subscription is bound to another Conta.', 'PLATFORM_BILLING_WEBHOOK_INVALID');
  }
  if (account.stripeSubscriptionId && account.stripeSubscriptionId !== subscriptionId) {
    // A late event from a superseded subscription must not replace the current
    // subscription bound to this Conta.
    return account.contaId;
  }

  let subscriptionState = subscription;
  const eventCreatedAt = readUnixDate(input.event.created);
  if (
    eventCreatedAt && account.lastProviderEventCreatedAt?.getTime() === eventCreatedAt.getTime()
  ) {
    // Stripe event timestamps are second-precision. On a tie, use the current
    // provider object so delivery order cannot choose an older event snapshot.
    const canonical = await (input.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource))
      .retrieveSubscription(subscriptionId);
    subscriptionState = {
      ...subscription,
      status: canonical.status,
      cancel_at_period_end: canonical.cancelAtPeriodEnd,
      current_period_end: canonical.currentPeriodEnd ? Math.floor(canonical.currentPeriodEnd.getTime() / 1000) : null,
      trial_end: canonical.trialEndsAt ? Math.floor(canonical.trialEndsAt.getTime() / 1000) : null,
      canceled_at: canonical.canceledAt ? Math.floor(canonical.canceledAt.getTime() / 1000) : null,
      pending_update: canonical.pendingUpdateId ? {} : null,
      items: { data: [{ price: { id: canonical.priceId } }] },
    };
  }

  const statePriceId = readSubscriptionPriceId(subscriptionState);
  const planCode = statePriceId ? resolvePlanCodeSafely(statePriceId, input) : account.planCode;
  const status = mapSubscriptionStatus(readString(subscriptionState.status));
  const pendingPlanCode = account.pendingPlanCode;
  const pendingPlanChangeId = account.pendingChangeOperationId;
  const pendingChangeType = account.pendingChangeType === 'UPGRADE' || account.pendingChangeType === 'DOWNGRADE'
    ? account.pendingChangeType
    : null;
  const paymentMethod = readPaymentMethodFromSubscription(subscription);
  const shouldCommitPlan = shouldCommitPlanFromSubscriptionStatus(status);
  const accountPlanCode = shouldCommitPlan ? planCode : account.planCode;
  const pendingUpdateExpired = input.event.type === 'customer.subscription.pending_update_expired';
  const hasCanonicalPendingUpdate = Boolean(subscriptionState.pending_update);
  const confirmsPendingPlanApplied = Boolean(
    pendingPlanCode && shouldCommitPlan
    && planCode === pendingPlanCode && statePriceId === resolveStripePriceId({
      planCode: pendingPlanCode,
      environment: input.environment,
      source: input.envSource,
    }),
  );
  const confirmsPendingUpdateExpired = Boolean(
    pendingUpdateExpired && pendingPlanCode
    && account.pendingChangeType === 'UPGRADE'
    && account.pendingChangeOperationId
    && readMetadata(subscription).planChangeId === account.pendingChangeOperationId
    && !hasCanonicalPendingUpdate
    && statePriceId && statePriceId === account.stripePriceId,
  );
  const shouldClearPendingPlan = Boolean(
    pendingPlanCode && (
      confirmsPendingPlanApplied || confirmsPendingUpdateExpired
    ),
  );
  const planChangeFinalization = pendingPlanChangeId && pendingPlanCode && pendingChangeType
    && (confirmsPendingPlanApplied || confirmsPendingUpdateExpired)
    ? {
        planChangeId: pendingPlanChangeId,
        contaId: account.contaId,
        billingAccountId: account.id,
        environment: input.environment,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: resolveStripePriceId({
          planCode: pendingPlanCode,
          environment: input.environment,
          source: input.envSource,
        }),
        toPlanCode: pendingPlanCode,
        type: pendingChangeType,
        applied: confirmsPendingPlanApplied,
      }
    : undefined;
  const isTerminalCancellation = status === 'CANCELED' || status === 'INCOMPLETE_EXPIRED';
  const updated = await store.updateAccountFromStripeSubscription({
    accountId: account.id,
    expectedAccountSnapshot: {
      contaId: account.contaId,
      environment: account.environment,
      stripeSubscriptionId: account.stripeSubscriptionId,
      pendingChangeOperationId: account.pendingChangeOperationId,
      pendingChangeClaimToken: account.pendingChangeClaimToken ?? null,
      lastProviderEventCreatedAt: account.lastProviderEventCreatedAt,
      lastStripeEventId: account.lastStripeEventId ?? null,
    },
    status,
    accessStatus: mapAccessStatusFromSubscription(status),
    planCode: accountPlanCode,
    stripeSubscriptionId: subscriptionId,
    webhookLease: input.workerId && input.inboxId ? { id: input.inboxId, workerId: input.workerId } : undefined,
    stripePriceId: shouldCommitPlan ? statePriceId : account.stripePriceId,
    currentPeriodEnd: readSubscriptionCurrentPeriodEnd(subscriptionState),
    cancelAtPeriodEnd: isTerminalCancellation ? false : subscriptionState.cancel_at_period_end === true,
    trialEndsAt: readUnixDate(subscriptionState.trial_end),
    canceledAt: readUnixDate(subscriptionState.canceled_at),
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
    pendingChangeOperationId: shouldClearPendingPlan ? null : undefined,
    planChangeFinalization,
    lastStripeEventId: input.event.id,
  });

  await store.createAuditLog({
    contaId: updated.contaId,
    billingAccountId: updated.id,
    action: 'PLATFORM_BILLING_SUBSCRIPTION_SYNCED',
    webhookEnvironment: input.environment,
    webhookEventId: input.event.id,
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

function isForeignKeyConstraintError(error: unknown): error is { code: 'P2003' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003';
}

async function processInvoiceEvent(
  invoice: StripeObject,
  input: ProcessPlatformBillingWebhookInput,
  store: PlatformBillingStore,
  options: { verifiedCanonicalPaidInvoice?: boolean } = {},
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
    (!subscriptionId ? await store.findAccountByStripeCustomerId({
      environment: input.environment,
      stripeCustomerId: customerId,
    }) : null);

  if (!account) {
    throw new PlatformBillingError(
      'Stripe invoice could not be bound to a platform billing account.',
      'PLATFORM_BILLING_ACCOUNT_NOT_FOUND',
      { invoiceId, subscriptionId, environment: input.environment },
    );
  }
  const invoiceContaId = readMetadata(invoice).contaId;
  if (invoiceContaId && invoiceContaId !== account.contaId) {
    throw new PlatformBillingError('Stripe invoice is bound to another Conta.', 'PLATFORM_BILLING_WEBHOOK_INVALID');
  }

  const invoicePrice = readInvoicePriceId(invoice);
  if (invoicePrice.ambiguous) {
    throw new PlatformBillingError('Stripe invoice contains multiple distinct non-proration prices.', 'PLATFORM_BILLING_WEBHOOK_INVALID', { invoiceId });
  }
  const priceId = invoicePrice.priceId ?? account.stripePriceId;
  const planCode = priceId ? resolvePlanCodeSafely(priceId, input) : account.planCode;
  const isPaymentFailedEvent = input.event.type === 'invoice.payment_failed' || input.event.type === 'invoice.payment_action_required';
  const isPaymentPaidEvent = input.event.type === 'invoice.paid' || input.event.type === 'invoice.payment_succeeded' ||
    options.verifiedCanonicalPaidInvoice === true;
  const invoiceFailure = readInvoicePaymentFailure(invoice);
  const nextPaymentAttempt = readUnixDate(invoice.next_payment_attempt);
  const invoiceStatus = mapInvoiceStatus(readString(invoice.status));
  const amountDue = readNumber(invoice.amount_due) ?? 0;
  const amountPaid = readNumber(invoice.amount_paid) ?? 0;
  const effectiveFailure = isPaymentFailedEvent && invoiceStatus !== 'PAID';
  const subscriptionToPersist = subscriptionId ?? account.stripeSubscriptionId;
  const paidConversion = isPaymentPaidEvent && amountPaid > 0 &&
    invoiceStatus === 'PAID' && subscriptionId !== null &&
    subscriptionId === account.stripeSubscriptionId;
  const failedAt = effectiveFailure
    ? readUnixDate(input.event.created) ?? new Date()
    : isPaymentPaidEvent ? null : undefined;
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
    paidAt: readUnixDate(invoice.status_transitions && (invoice.status_transitions as StripeObject).paid_at)
      ?? (paidConversion && !options.verifiedCanonicalPaidInvoice ? readUnixDate(input.event.created) ?? new Date() : undefined),
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
    action: options.verifiedCanonicalPaidInvoice
      ? 'PLATFORM_BILLING_CHECKOUT_PAYMENT_RECONCILED'
      : resolveInvoiceAuditAction(input.event.type),
    webhookEnvironment: input.environment,
    webhookEventId: input.event.id,
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

  if (subscriptionToPersist && (effectiveFailure || paidConversion)) {
    const paymentStateChangedAt = failedAt ??
      readUnixDate(invoice.status_transitions && (invoice.status_transitions as StripeObject).paid_at) ??
      readUnixDate(input.event.created) ?? new Date();
    const graceEligible = isPaymentPaidSubscriptionEligible(account);
    const canonicalReactivation = paidConversion && account.status === 'CANCELED'
      ? await getCanonicalActiveBoundSubscription({
          subscriptionId,
          customerId,
          account,
          expectedPriceId: priceId,
          environment: input.environment,
          gateway: input.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource),
        })
      : null;
    const confirmsReactivation = Boolean(canonicalReactivation && account.pendingChangeType === 'REACTIVATE');
    const nextStatus = resolveInvoicePaymentAccountStatus({
      accountStatus: account.status,
      trialEndsAt: account.trialEndsAt,
      isPaymentFailed: effectiveFailure,
      graceEligible,
      isPaidBoundSubscriptionActive: Boolean(canonicalReactivation),
    });
    const nextAccessStatus = effectiveFailure && !graceEligible
      ? 'RESTRICTED'
      : mapAccessStatusFromSubscription(nextStatus);
    const updatedAccount = await store.updateAccountFromStripeSubscription({
      accountId: account.id,
      expectedAccountSnapshot: {
        contaId: account.contaId,
        environment: account.environment,
        stripeSubscriptionId: account.stripeSubscriptionId,
        pendingChangeOperationId: account.pendingChangeOperationId,
        pendingChangeClaimToken: account.pendingChangeClaimToken ?? null,
        lastProviderEventCreatedAt: account.lastProviderEventCreatedAt,
        lastStripeEventId: account.lastStripeEventId ?? null,
      },
      status: nextStatus,
      accessStatus: nextAccessStatus,
      planCode,
      stripeSubscriptionId: subscriptionToPersist,
      webhookLease: input.workerId && input.inboxId ? { id: input.inboxId, workerId: input.workerId } : undefined,
      stripePriceId: priceId,
      currentPeriodEnd: canonicalReactivation?.currentPeriodEnd ?? account.currentPeriodEnd,
      cancelAtPeriodEnd: canonicalReactivation?.cancelAtPeriodEnd ?? account.cancelAtPeriodEnd,
      trialEndsAt: canonicalReactivation?.trialEndsAt ?? account.trialEndsAt,
      gracePeriodEndsAt: effectiveFailure && graceEligible
        ? account.gracePeriodEndsAt ?? computeGracePeriodEnd({
          failedAt: account.gracePeriodStartedAt ?? paymentStateChangedAt,
        })
        : null,
      restrictedAt: effectiveFailure && !graceEligible ? paymentStateChangedAt : null,
      lastPaymentFailedAt: effectiveFailure ? paymentStateChangedAt : null,
      firstPaidAt: paidConversion ? account.firstPaidAt ?? paymentStateChangedAt : undefined,
      lastSuccessfulPaymentAt: paidConversion ? paymentStateChangedAt : undefined,
      restrictionReason: effectiveFailure && !graceEligible
        ? account.firstPaidAt || account.lastSuccessfulPaymentAt
          ? account.paymentMethodStatus === 'MISSING'
            ? 'PAYMENT_METHOD_MISSING'
            : 'PAYMENT_PAST_DUE'
          : 'FIRST_PAYMENT_INCOMPLETE'
        : null,
      gracePeriodStartedAt: effectiveFailure && graceEligible
        ? account.gracePeriodStartedAt ?? paymentStateChangedAt
        : null,
      canceledAt: canonicalReactivation ? null : account.canceledAt,
      lastProviderEventCreatedAt: readUnixDate(input.event.created),
      pendingPlanCode: confirmsReactivation ? null : undefined,
      pendingChangeType: effectiveFailure && graceEligible
        ? 'PAYMENT_RECOVERY'
        : paidConversion && (account.pendingChangeType === 'PAYMENT_RECOVERY' || confirmsReactivation)
          ? null
          : undefined,
      pendingChangeEffectiveAt: effectiveFailure && graceEligible
        ? nextPaymentAttempt
        : paidConversion && (account.pendingChangeType === 'PAYMENT_RECOVERY' || confirmsReactivation)
          ? null
          : undefined,
      pendingChangeOperationId: confirmsReactivation ? null : undefined,
      lastStripeEventId: input.event.id,
    });

    if (paidConversion && updatedAccount.lastStripeEventId === input.event.id) {
      await store.resolveOpenIssuesForPaidAccount?.({
        contaId: account.contaId,
        billingAccountId: account.id,
        environment: input.environment,
        correlationId: input.event.id,
      });
    }
  }

  return account.contaId;
}

function resolveInvoicePaymentAccountStatus(input: {
  accountStatus: PlatformBillingAccountStatus;
  trialEndsAt: Date | null;
  isPaymentFailed: boolean;
  graceEligible: boolean;
  isPaidBoundSubscriptionActive: boolean;
}): PlatformBillingAccountStatus {
  if (input.isPaymentFailed && input.graceEligible) return 'PAST_DUE';
  if (input.isPaymentFailed) return input.accountStatus;
  if (input.isPaidBoundSubscriptionActive) return 'ACTIVE';
  if (input.accountStatus === 'CANCELED') return 'CANCELED';
  if (input.trialEndsAt && input.trialEndsAt.getTime() > Date.now()) return 'TRIALING';
  return 'ACTIVE';
}

async function getCanonicalActiveBoundSubscription(input: {
  subscriptionId: string | null;
  customerId: string;
  account: PlatformBillingAccountRecord;
  expectedPriceId: string | null;
  environment: PlatformBillingEnvironment;
  gateway: Pick<PlatformBillingStripeGateway, 'retrieveSubscriptionSnapshot'>;
}): Promise<Awaited<ReturnType<PlatformBillingStripeGateway['retrieveSubscriptionSnapshot']>> | null> {
  if (!input.subscriptionId || !input.expectedPriceId || !input.account.stripeCustomerId ||
    input.account.stripeCustomerId !== input.customerId) return null;
  const snapshot = await input.gateway.retrieveSubscriptionSnapshot(input.subscriptionId);
  const expectedPlanCode = input.account.pendingPlanCode ?? input.account.planCode;
  if (snapshot.id === input.subscriptionId &&
    snapshot.customerId === input.customerId &&
    snapshot.status === 'active' &&
    snapshot.livemode === (input.environment === 'LIVE') &&
    snapshot.metadata.contaId === input.account.contaId &&
    snapshot.metadata.billingContext === 'platform' &&
    snapshot.metadata.planCode === expectedPlanCode &&
    snapshot.priceIds.length === 1 &&
    snapshot.priceIds[0] === input.expectedPriceId) return snapshot;
  return null;
}

function isVerifiedPaidCheckoutInvoice(input: {
  invoice: StripeObject;
  account: PlatformBillingAccountRecord;
  subscriptionId: string;
  customerId: string;
  priceId: string;
  environment: PlatformBillingEnvironment;
}): boolean {
  const { invoice, account } = input;
  const price = readInvoicePriceId(invoice);
  const metadata = readMetadata(invoice);
  const paidAt = readUnixDate(invoice.status_transitions && (invoice.status_transitions as StripeObject).paid_at);
  const livemode = readBoolean(invoice.livemode);
  return readString(invoice.status) === 'paid' &&
    (readNumber(invoice.amount_paid) ?? 0) > 0 &&
    Boolean(paidAt) &&
    readString(invoice.currency)?.toLowerCase() === 'brl' &&
    (readStripeId(invoice.customer) === input.customerId) &&
    (readStripeId(invoice.subscription) ?? readNestedString(invoice, ['parent', 'subscription_details', 'subscription'])) === input.subscriptionId &&
    !price.ambiguous && price.priceId === input.priceId &&
    (!metadata.contaId || metadata.contaId === account.contaId) &&
    livemode === (input.environment === 'LIVE') &&
    account.stripeSubscriptionId === input.subscriptionId &&
    account.stripeCustomerId === input.customerId;
}

function isPaymentPaidSubscriptionEligible(account: {
  status: PlatformBillingAccountStatus;
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
}): boolean {
  // Trial accounts never receive the commercial grace period. A failed invoice
  // during/at the end of a trial must be regularized before operational access
  // is restored. ACTIVE/PAST_DUE are states of an already paid subscription.
  return Boolean(
    (account.status === 'ACTIVE' || account.status === 'PAST_DUE') &&
    (account.firstPaidAt || account.lastSuccessfulPaymentAt),
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

function readInvoicePriceId(invoice: StripeObject): { priceId: string | null; ambiguous: boolean } {
  const lines = readRecord(invoice.lines).data;
  if (!Array.isArray(lines)) return { priceId: null, ambiguous: false };
  const prices = new Set<string>();
  for (const value of lines) {
    const line = readRecord(value);
    const subscriptionItemDetails = readRecord(readRecord(line.parent).subscription_item_details);
    const legacySubscriptionItemDetails = readRecord(line.subscription_item_details);
    if (
      line.proration === true
      || subscriptionItemDetails.proration === true
      || legacySubscriptionItemDetails.proration === true
    ) continue;
    const pricingPrice = readStripeId(readRecord(readRecord(line.pricing).price_details).price);
    const legacyPrice = readStripeId(line.price);
    const priceId = pricingPrice ?? legacyPrice;
    if (priceId) prices.add(priceId);
  }
  return { priceId: prices.size === 1 ? [...prices][0]! : null, ambiguous: prices.size > 1 };
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
