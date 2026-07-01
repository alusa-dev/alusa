import type Stripe from 'stripe';

export interface CreateStripeBillingCustomerInput {
  name: string;
  email?: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
}

export interface StripeBillingCustomerResult {
  id: string;
  livemode: boolean;
}

export interface CreateStripeSubscriptionCheckoutSessionInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
}

export interface StripeSubscriptionCheckoutSessionResult {
  id: string;
  url: string | null;
  expiresAt: Date | null;
}

export interface CreateStripeBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
  configurationId?: string;
  idempotencyKey?: string;
}

export interface StripeBillingPortalSessionResult {
  id: string;
  url: string;
}

export interface StripeSubscriptionRecord {
  id: string;
  customerId: string | null;
  status: string;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  pendingUpdateId: string | null;
}

export interface PreviewStripeSubscriptionPlanChangeInput {
  subscriptionId: string;
  priceId: string;
  prorationDate?: number;
  idempotencyKey?: string;
}

export interface StripeSubscriptionPlanChangePreview {
  invoiceId: string | null;
  amountDue: number;
  amountRemaining: number;
  currency: string;
  nextPaymentAttempt: Date | null;
}

export interface UpdateStripeSubscriptionPlanInput {
  subscriptionId: string;
  priceId: string;
  paymentBehavior?: 'allow_incomplete' | 'default_incomplete' | 'error_if_incomplete' | 'pending_if_incomplete';
  prorationBehavior?: 'always_invoice' | 'create_prorations' | 'none';
  prorationDate?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export async function createStripeBillingCustomer(
  client: Stripe,
  input: CreateStripeBillingCustomerInput,
): Promise<StripeBillingCustomerResult> {
  const customer = await client.customers.create(
    {
      name: input.name,
      email: input.email,
      metadata: input.metadata,
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return {
    id: customer.id,
    livemode: customer.livemode,
  };
}

export async function createStripeSubscriptionCheckoutSession(
  client: Stripe,
  input: CreateStripeSubscriptionCheckoutSessionInput,
): Promise<StripeSubscriptionCheckoutSessionResult> {
  const session = await client.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      subscription_data: {
        metadata: input.metadata,
      },
      allow_promotion_codes: true,
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return {
    id: session.id,
    url: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
  };
}

export async function createStripeBillingPortalSession(
  client: Stripe,
  input: CreateStripeBillingPortalSessionInput,
): Promise<StripeBillingPortalSessionResult> {
  const session = await client.billingPortal.sessions.create(
    {
      customer: input.customerId,
      return_url: input.returnUrl,
      configuration: input.configurationId,
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return {
    id: session.id,
    url: session.url,
  };
}

export async function retrieveStripeSubscription(
  client: Stripe,
  subscriptionId: string,
): Promise<StripeSubscriptionRecord> {
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  return toSubscriptionRecord(subscription);
}

export async function previewStripeSubscriptionPlanChange(
  client: Stripe,
  input: PreviewStripeSubscriptionPlanChangeInput,
): Promise<StripeSubscriptionPlanChangePreview> {
  const subscription = await client.subscriptions.retrieve(input.subscriptionId);
  const item = subscription.items.data[0];
  if (!item) throw new Error('Stripe subscription has no subscription item.');

  const invoices = client.invoices as Stripe['invoices'] & {
    createPreview(
      _params: {
        subscription: string;
        subscription_details: {
          items: Array<{ id: string; price: string }>;
          proration_date?: number;
          proration_behavior?: 'always_invoice' | 'create_prorations' | 'none';
        };
      },
      _options?: Stripe.RequestOptions,
    ): Promise<Stripe.Invoice>;
  };

  const invoice = await invoices.createPreview(
    {
      subscription: input.subscriptionId,
      subscription_details: {
        items: [{ id: item.id, price: input.priceId }],
        proration_date: input.prorationDate,
        proration_behavior: 'always_invoice',
      },
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return {
    invoiceId: invoice.id ?? null,
    amountDue: invoice.amount_due ?? 0,
    amountRemaining: invoice.amount_remaining ?? 0,
    currency: invoice.currency ?? 'brl',
    nextPaymentAttempt: readUnixDate(readRecord(invoice).next_payment_attempt),
  };
}

export async function updateStripeSubscriptionPlan(
  client: Stripe,
  input: UpdateStripeSubscriptionPlanInput,
): Promise<StripeSubscriptionRecord> {
  const subscription = await client.subscriptions.retrieve(input.subscriptionId);
  const item = subscription.items.data[0];
  if (!item) throw new Error('Stripe subscription has no subscription item.');

  const updated = await client.subscriptions.update(
    input.subscriptionId,
    {
      items: [{ id: item.id, price: input.priceId }],
      payment_behavior: input.paymentBehavior ?? 'pending_if_incomplete',
      proration_behavior: input.prorationBehavior ?? 'always_invoice',
      proration_date: input.prorationDate,
      metadata: input.metadata,
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return toSubscriptionRecord(updated);
}

export async function updateStripeSubscriptionCancelAtPeriodEnd(
  client: Stripe,
  input: {
    subscriptionId: string;
    cancelAtPeriodEnd: boolean;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  },
): Promise<StripeSubscriptionRecord> {
  const updated = await client.subscriptions.update(
    input.subscriptionId,
    {
      cancel_at_period_end: input.cancelAtPeriodEnd,
      metadata: input.metadata,
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return toSubscriptionRecord(updated);
}

function buildRequestOptions(idempotencyKey: string | undefined): Stripe.RequestOptions | undefined {
  return idempotencyKey ? { idempotencyKey } : undefined;
}

function toSubscriptionRecord(subscription: Stripe.Subscription): StripeSubscriptionRecord {
  const item = subscription.items.data[0];
  const raw = readRecord(subscription);
  const pendingUpdate = readRecord(raw.pending_update);

  return {
    id: subscription.id,
    customerId: readStripeId(subscription.customer),
    status: subscription.status,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: readUnixDate(raw.current_period_end) ?? readUnixDate(readRecord(item).current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    trialEndsAt: readUnixDate(raw.trial_end),
    pendingUpdateId: readString(pendingUpdate.id),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStripeId(value: string | { id?: string } | null): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

function readUnixDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}
