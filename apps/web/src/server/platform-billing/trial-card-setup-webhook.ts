import type { StripeWebhookEvent } from '@alusa/stripe';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';

export const TRIAL_CARD_SETUP_SUCCESS_ACTION = 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED';
export const TRIAL_CARD_SETUP_EXPIRED_ACTION = 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED';

export interface TrialCardSetupStripeGateway {
  retrieveSession(sessionId: string): Promise<Record<string, unknown>>;
  retrieveSetupIntent(setupIntentId: string): Promise<Record<string, unknown>>;
  allowPaymentMethodRedisplay(paymentMethodId: string): Promise<Record<string, unknown>>;
}

export interface TrialCardSetupConsent {
  accountId: string;
  stripeCustomerId: string;
  consentVersion: string;
  acceptedAt: string;
  sessionId: string;
  alreadyCompleted: boolean;
}

export interface CompleteTrialCardSetupInput {
  event: StripeWebhookEvent;
  environment: PlatformBillingEnvironment;
  stripe: TrialCardSetupStripeGateway;
  loadConsent(input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    customerId: string;
    requestKey: string;
    sessionId: string;
  }): Promise<TrialCardSetupConsent | null>;
  record(input: {
    contaId: string;
    accountId: string;
    environment: PlatformBillingEnvironment;
    eventId: string | null;
    source: 'stripe_webhook' | 'read_only_reconciliation';
    requestKey: string;
    sessionId: string;
    setupIntentId: string;
    paymentMethodId: string;
    card: { brand: string | null; last4: string; expMonth: number | null; expYear: number | null };
    consentVersion: string;
    acceptedAt: string;
  }): Promise<void>;
}

/**
 * Verify successful Setup Checkout against Stripe and persisted tenant consent.
 * The operation deliberately only updates PaymentMethod.allow_redisplay; it
 * does not write Customer or Subscription defaults or grant billing access.
 */
export async function completeTrialCardSetup(input: CompleteTrialCardSetupInput): Promise<{ contaId: string }> {
  if (input.event.type !== 'checkout.session.completed') throw new Error('Unsupported setup event.');
  const eventSession = object(input.event.data.object);
  const eventMetadata = object(eventSession.metadata);
  const sessionId = string(eventSession.id);
  const contaId = string(eventMetadata.contaId);
  const customerId = stripeId(eventSession.customer);
  const requestKey = string(eventMetadata.consentRequestKey);
  const consentVersion = string(eventMetadata.consentVersion);
  const acceptedAt = string(eventMetadata.consentAcceptedAt);
  const purpose = eventMetadata.checkoutPurpose === 'optional_trial_payment_method'
    && eventMetadata.billingContext === 'platform';
  if (!sessionId || !contaId || !customerId || !requestKey || !consentVersion || !acceptedAt || !purpose) {
    throw new Error('Setup Checkout metadata is incomplete or invalid.');
  }

  return completeTrialCardSetupSession({
    sessionId, expected: { contaId, customerId, requestKey, consentVersion, acceptedAt },
    eventId: input.event.id, source: 'stripe_webhook', ...input,
  });
}

export async function completeTrialCardSetupSession(input: {
  sessionId: string;
  expected: { contaId: string; customerId: string; requestKey: string; consentVersion: string; acceptedAt: string };
  eventId: string | null;
  source: 'stripe_webhook' | 'read_only_reconciliation';
  environment: PlatformBillingEnvironment;
  stripe: TrialCardSetupStripeGateway;
  loadConsent(input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    customerId: string;
    requestKey: string;
    sessionId: string;
  }): Promise<TrialCardSetupConsent | null>;
  record(input: {
    contaId: string;
    accountId: string;
    environment: PlatformBillingEnvironment;
    eventId: string | null;
    source: 'stripe_webhook' | 'read_only_reconciliation';
    requestKey: string;
    sessionId: string;
    setupIntentId: string;
    paymentMethodId: string;
    card: { brand: string | null; last4: string; expMonth: number | null; expYear: number | null };
    consentVersion: string;
    acceptedAt: string;
  }): Promise<void>;
}): Promise<{ contaId: string }> {
  const { contaId, customerId, requestKey, consentVersion, acceptedAt } = input.expected;
  const { sessionId } = input;
  const session = await input.stripe.retrieveSession(sessionId);
  const metadata = object(session.metadata);
  if (session.id !== sessionId || session.mode !== 'setup' || session.status !== 'complete'
    || stripeId(session.customer) !== customerId || session.client_reference_id !== contaId
    || metadata.contaId !== contaId || metadata.billingContext !== 'platform'
    || metadata.checkoutPurpose !== 'optional_trial_payment_method'
    || metadata.consentRequestKey !== requestKey || metadata.consentVersion !== consentVersion
    || metadata.consentAcceptedAt !== acceptedAt) {
    throw new Error('Stripe Setup Checkout session verification failed.');
  }
  const setupIntentId = stripeId(session.setup_intent);
  if (!setupIntentId) throw new Error('Completed Setup Checkout has no SetupIntent.');
  const setupIntent = await input.stripe.retrieveSetupIntent(setupIntentId);
  const intentMetadata = object(setupIntent.metadata);
  if (setupIntent.id !== setupIntentId || setupIntent.status !== 'succeeded'
    || stripeId(setupIntent.customer) !== customerId
    || intentMetadata.contaId !== contaId || intentMetadata.billingContext !== 'platform'
    || intentMetadata.checkoutPurpose !== 'optional_trial_payment_method'
    || intentMetadata.consentRequestKey !== requestKey || intentMetadata.consentVersion !== consentVersion
    || intentMetadata.consentAcceptedAt !== acceptedAt) {
    throw new Error('Stripe SetupIntent verification failed.');
  }
  const paymentMethod = object(setupIntent.payment_method);
  const paymentMethodId = stripeId(setupIntent.payment_method);
  const card = object(paymentMethod.card);
  const last4 = string(card.last4);
  if (paymentMethod.object !== 'payment_method' || paymentMethod.type !== 'card'
    || !paymentMethodId || stripeId(paymentMethod.customer) !== customerId || !last4) {
    throw new Error('SetupIntent does not contain a customer-bound card.');
  }

  const consent = await input.loadConsent({
    contaId, environment: input.environment, customerId, requestKey, sessionId,
  });
  if (!consent || consent.stripeCustomerId !== customerId || consent.sessionId !== sessionId
    || consent.consentVersion !== consentVersion || consent.acceptedAt !== acceptedAt) {
    throw new Error('Setup Checkout has no matching tenant consent record.');
  }
  if (!consent.alreadyCompleted) {
    const updated = await input.stripe.allowPaymentMethodRedisplay(paymentMethodId);
    if (updated.id !== paymentMethodId || updated.allow_redisplay !== 'always') {
      throw new Error('Stripe did not confirm PaymentMethod redisplay update.');
    }
  }
  await input.record({
    contaId, accountId: consent.accountId, environment: input.environment,
    eventId: input.eventId, source: input.source, requestKey, sessionId, setupIntentId, paymentMethodId,
    card: {
      brand: string(card.brand), last4,
      expMonth: number(card.exp_month), expYear: number(card.exp_year),
    },
    consentVersion, acceptedAt,
  });
  return { contaId };
}

export interface ExpireTrialCardSetupInput {
  event: StripeWebhookEvent;
  environment: PlatformBillingEnvironment;
  retrieveSession(sessionId: string): Promise<Record<string, unknown>>;
  loadConsent(input: {
    contaId: string;
    environment: PlatformBillingEnvironment;
    customerId: string;
    requestKey: string;
    sessionId: string;
  }): Promise<TrialCardSetupConsent | null>;
  record(input: {
    contaId: string;
    accountId: string;
    environment: PlatformBillingEnvironment;
    eventId: string;
    requestKey: string;
    sessionId: string;
  }): Promise<void>;
}

/** Verify Stripe's expiration and persisted tenant consent before releasing a setup claim. */
export async function expireTrialCardSetup(input: ExpireTrialCardSetupInput): Promise<{ contaId: string }> {
  if (input.event.type !== 'checkout.session.expired') throw new Error('Unsupported setup expiration event.');
  const eventSession = object(input.event.data.object);
  const eventMetadata = object(eventSession.metadata);
  const sessionId = string(eventSession.id);
  const contaId = string(eventMetadata.contaId);
  const customerId = stripeId(eventSession.customer);
  const requestKey = string(eventMetadata.consentRequestKey);
  const consentVersion = string(eventMetadata.consentVersion);
  const acceptedAt = string(eventMetadata.consentAcceptedAt);
  if (!sessionId || !contaId || !customerId || !requestKey || !consentVersion || !acceptedAt
    || eventMetadata.billingContext !== 'platform'
    || eventMetadata.checkoutPurpose !== 'optional_trial_payment_method') {
    throw new Error('Expired Setup Checkout metadata is incomplete or invalid.');
  }

  const session = await input.retrieveSession(sessionId);
  const metadata = object(session.metadata);
  if (session.id !== sessionId || session.mode !== 'setup' || session.status !== 'expired'
    || stripeId(session.customer) !== customerId || session.client_reference_id !== contaId
    || metadata.contaId !== contaId || metadata.billingContext !== 'platform'
    || metadata.checkoutPurpose !== 'optional_trial_payment_method'
    || metadata.consentRequestKey !== requestKey || metadata.consentVersion !== consentVersion
    || metadata.consentAcceptedAt !== acceptedAt) {
    throw new Error('Stripe expired Setup Checkout session verification failed.');
  }
  const consent = await input.loadConsent({ contaId, environment: input.environment, customerId, requestKey, sessionId });
  if (!consent || consent.stripeCustomerId !== customerId || consent.sessionId !== sessionId
    || consent.consentVersion !== consentVersion || consent.acceptedAt !== acceptedAt) {
    throw new Error('Expired Setup Checkout has no matching tenant consent record.');
  }
  await input.record({
    contaId, accountId: consent.accountId, environment: input.environment,
    eventId: input.event.id, requestKey, sessionId,
  });
  return { contaId };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function stripeId(value: unknown): string | null { return typeof value === 'string' ? value : string(object(value).id); }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
