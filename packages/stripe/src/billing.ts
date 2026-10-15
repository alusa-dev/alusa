import type Stripe from 'stripe';

/**
 * A schedule has already been created or was already attached to the
 * subscription when its phase update failed. The remote workflow therefore
 * has an effect even when Stripe classifies the update request itself as a
 * definitive 4xx. Callers must retain their operation claim and retry using
 * the same idempotency key so the owned schedule can be completed.
 */
export class StripeScheduleUpdateRecoveryError extends Error {
  readonly code = 'STRIPE_SCHEDULE_UPDATE_RECOVERY_REQUIRED';
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('Stripe schedule exists but its phase update failed; retry the same plan change to recover it.');
    this.name = 'StripeScheduleUpdateRecoveryError';
    this.cause = cause;
  }
}

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
  trialDays?: number | null;
  idempotencyKey?: string;
}

export interface StripeSubscriptionCheckoutSessionResult {
  id: string;
  url: string | null;
  expiresAt: Date | null;
}

export interface CreateStripeTrialSubscriptionWithoutPaymentMethodInput {
  customerId: string;
  priceId: string;
  metadata: Record<string, string>;
  trialDays: number;
  idempotencyKey?: string;
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

export interface StripeInvoiceRecord {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  priceId: string | null;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  createdAt: Date | null;
  attempted: boolean;
  attemptCount: number;
  nextPaymentAttempt: Date | null;
  lastPaymentErrorCode: string | null;
  lastPaymentErrorMessage: string | null;
  raw: Record<string, unknown>;
}

export interface RetrieveStripeDefaultPaymentMethodInput {
  customerId: string;
  subscriptionId?: string | null;
}

export interface StripeDefaultPaymentMethodRecord {
  id: string;
  type: 'card';
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
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

export interface ScheduleStripeSubscriptionPlanChangeInput {
  subscriptionId: string;
  priceId: string;
  effectiveAt: Date;
  metadata: Record<string, string>;
  idempotencyKey: string;
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
        ...(input.trialDays
          ? {
              trial_period_days: input.trialDays,
              trial_settings: {
                end_behavior: {
                  missing_payment_method: 'cancel',
                },
              },
            }
          : {}),
      },
      payment_method_collection: input.trialDays ? 'always' : 'if_required',
      saved_payment_method_options: {
        allow_redisplay_filters: ['always', 'limited'],
        payment_method_remove: 'enabled',
        payment_method_save: 'enabled',
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

export async function createStripeTrialSubscriptionWithoutPaymentMethod(
  client: Stripe,
  input: CreateStripeTrialSubscriptionWithoutPaymentMethodInput,
): Promise<StripeSubscriptionRecord> {
  const subscription = await client.subscriptions.create(
    {
      customer: input.customerId,
      items: [{ price: input.priceId, quantity: 1 }],
      metadata: input.metadata,
      trial_period_days: input.trialDays,
      trial_settings: {
        end_behavior: {
          missing_payment_method: 'pause',
        },
      },
    },
    buildRequestOptions(input.idempotencyKey),
  );

  return toSubscriptionRecord(subscription);
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

export async function retrieveStripeSubscriptionEventObject(
  client: Stripe,
  subscriptionId: string,
): Promise<Record<string, unknown>> {
  return readRecord(await client.subscriptions.retrieve(subscriptionId));
}

export async function retrieveStripeInvoiceEventObject(
  client: Stripe,
  invoiceId: string,
): Promise<Record<string, unknown>> {
  return readRecord(await client.invoices.retrieve(invoiceId));
}

export async function listStripePaidInvoices(
  client: Stripe,
  customerId: string,
): Promise<StripeInvoiceRecord[]> {
  const result: StripeInvoiceRecord[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await client.invoices.list({
      customer: customerId,
      status: 'paid',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    result.push(...page.data.map(toInvoiceRecord).filter((invoice) => invoice.amountPaid > 0));
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return result;
}

export async function retrieveStripeDefaultPaymentMethod(
  client: Stripe,
  input: RetrieveStripeDefaultPaymentMethodInput,
): Promise<StripeDefaultPaymentMethodRecord | null> {
  if (input.subscriptionId) {
    const subscription = await client.subscriptions.retrieve(input.subscriptionId, {
      expand: ['default_payment_method'],
    });
    const subscriptionPaymentMethod = await resolvePaymentMethodRecord(
      client,
      readRecord(subscription).default_payment_method,
    );
    if (subscriptionPaymentMethod) return subscriptionPaymentMethod;
  }

  const customer = await client.customers.retrieve(input.customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  const customerRecord = readRecord(customer);
  if (customerRecord.deleted === true) return null;

  return resolvePaymentMethodRecord(
    client,
    readRecord(customerRecord.invoice_settings).default_payment_method,
  );
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

export async function scheduleStripeSubscriptionPlanChange(
  client: Stripe,
  input: ScheduleStripeSubscriptionPlanChangeInput,
): Promise<{ scheduleId: string; effectiveAt: Date }> {
  const subscription = await client.subscriptions.retrieve(input.subscriptionId, { expand: ['schedule'] });
  const attachedScheduleValue = readRecord(subscription).schedule;
  const attachedSchedule = readRecord(attachedScheduleValue);
  const attachedScheduleId = readStripeId(attachedScheduleValue);
  let schedule: Stripe.SubscriptionSchedule;
  if (attachedScheduleId) {
    schedule = attachedSchedule.phases
      ? attachedSchedule as unknown as Stripe.SubscriptionSchedule
      : await client.subscriptionSchedules.retrieve(attachedScheduleId);
    if (schedule.metadata?.alusaPlanChangeKey !== input.idempotencyKey) {
      throw new Error('Stripe subscription is already managed by another schedule; refusing to replace it.');
    }
    const effectiveAt = Math.floor(input.effectiveAt.getTime() / 1000);
    const targetIsScheduled = schedule.phases.some((phase) =>
      phase.start_date === effectiveAt && phase.items.some((item) => readStripeId(item.price) === input.priceId),
    );
    if (targetIsScheduled) return { scheduleId: schedule.id, effectiveAt: input.effectiveAt };
  } else {
    schedule = await client.subscriptionSchedules.create(
      {
        from_subscription: input.subscriptionId,
        metadata: { ...input.metadata, alusaPlanChangeKey: input.idempotencyKey },
      },
      buildRequestOptions(`${input.idempotencyKey}:create`),
    );
  }
  const currentPhase = schedule.phases.find((phase) =>
    phase.start_date === schedule.current_phase?.start_date,
  ) ?? schedule.phases.at(-1);
  if (!currentPhase || currentPhase.items.length !== 1) {
    await client.subscriptionSchedules.release(schedule.id).catch(() => undefined);
    throw new Error('Stripe schedule must contain exactly one current subscription item.');
  }
  if (!readStripeId(currentPhase.items[0]?.price)) {
    await client.subscriptionSchedules.release(schedule.id).catch(() => undefined);
    throw new Error('Stripe schedule phase contains an invalid price.');
  }

  const effectiveAt = Math.floor(input.effectiveAt.getTime() / 1000);
  const phaseItems = currentPhase.items.map((item, index) => {
    const existingPrice = readStripeId(item.price);
    if (!existingPrice) throw new Error('Stripe schedule phase contains an invalid price.');
    return {
      price: index === 0 ? input.priceId : existingPrice,
      ...(item.quantity ? { quantity: item.quantity } : {}),
    };
  });
  const sharedPhaseSettings = {
    ...(currentPhase.collection_method ? { collection_method: currentPhase.collection_method } : {}),
    ...(currentPhase.default_payment_method ? { default_payment_method: readStripeId(currentPhase.default_payment_method)! } : {}),
    ...(currentPhase.default_tax_rates ? { default_tax_rates: currentPhase.default_tax_rates.map((rate) => rate.id) } : {}),
    ...(currentPhase.discounts?.length ? { discounts: currentPhase.discounts.map((discount) => ({ coupon: readStripeId(discount.coupon) ?? undefined, promotion_code: readStripeId(discount.promotion_code) ?? undefined })) } : {}),
    ...(currentPhase.automatic_tax ? { automatic_tax: { enabled: currentPhase.automatic_tax.enabled } } : {}),
    ...(currentPhase.billing_thresholds ? { billing_thresholds: currentPhase.billing_thresholds as Stripe.SubscriptionScheduleUpdateParams.Phase.BillingThresholds } : {}),
    ...(currentPhase.description ? { description: currentPhase.description } : {}),
    ...(currentPhase.application_fee_percent !== null ? { application_fee_percent: currentPhase.application_fee_percent } : {}),
    ...(currentPhase.billing_cycle_anchor ? { billing_cycle_anchor: currentPhase.billing_cycle_anchor } : {}),
    ...(currentPhase.invoice_settings ? { invoice_settings: currentPhase.invoice_settings as Stripe.SubscriptionScheduleUpdateParams.Phase.InvoiceSettings } : {}),
    ...(currentPhase.metadata ? { metadata: { ...currentPhase.metadata, ...input.metadata } } : { metadata: input.metadata }),
    proration_behavior: 'none' as const,
  };
  try {
    await client.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      metadata: { ...schedule.metadata, ...input.metadata, alusaPlanChangeKey: input.idempotencyKey },
      phases: [
        {
          start_date: currentPhase.start_date,
          end_date: effectiveAt,
          items: currentPhase.items.map((item) => ({
            price: readStripeId(item.price)!,
            ...(item.quantity ? { quantity: item.quantity } : {}),
          })),
          ...sharedPhaseSettings,
        },
        {
          start_date: effectiveAt,
          items: phaseItems,
          ...sharedPhaseSettings,
        },
      ],
      proration_behavior: 'none',
    }, buildRequestOptions(`${input.idempotencyKey}:update`));
  } catch (error) {
    // Keep the owned schedule attached. Its create-time metadata makes this
    // partial state discoverable, and a same-key retry can safely finish the
    // update instead of encountering a released, unowned schedule.
    throw new StripeScheduleUpdateRecoveryError(error);
  }

  return { scheduleId: schedule.id, effectiveAt: input.effectiveAt };
}

export async function releaseStripeSubscriptionSchedule(
  client: Stripe,
  input: { scheduleId: string; idempotencyKey?: string },
): Promise<void> {
  await client.subscriptionSchedules.release(
    input.scheduleId,
    {},
    buildRequestOptions(input.idempotencyKey),
  );
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

function toInvoiceRecord(invoice: Stripe.Invoice): StripeInvoiceRecord {
  const raw = readRecord(invoice);
  const statusTransitions = readRecord(raw.status_transitions);
  const paymentError = readRecord(raw.last_finalization_error ?? raw.last_payment_error);
  const lines = readRecord(raw.lines);
  const lineRecords = Array.isArray(lines.data) ? lines.data.map(readRecord) : [];
  const priceCandidates = lineRecords
    .filter((line) => !isInvoiceLineProration(line))
    .map((line) => readStripeId(line.price) ?? readStripeId(readRecord(readRecord(line.pricing).price_details).price))
    .filter((value): value is string => Boolean(value));
  const uniquePriceCandidates = [...new Set(priceCandidates)];

  return {
    id: invoice.id,
    customerId: readStripeId(invoice.customer) ?? '',
    subscriptionId: readString(raw.subscription) ?? readString(readRecord(raw.subscription).id) ?? readNestedString(raw, ['parent', 'subscription_details', 'subscription']),
    priceId: uniquePriceCandidates.length === 1 ? uniquePriceCandidates[0] : null,
    number: readString(invoice.number),
    status: readString(invoice.status),
    amountDue: invoice.amount_due ?? 0,
    amountPaid: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? 'brl',
    hostedInvoiceUrl: readString(invoice.hosted_invoice_url),
    invoicePdf: readString(invoice.invoice_pdf),
    periodStart: readUnixDate(invoice.period_start),
    periodEnd: readUnixDate(invoice.period_end),
    dueDate: readUnixDate(invoice.due_date),
    paidAt: readUnixDate(statusTransitions.paid_at),
    createdAt: readUnixDate(invoice.created),
    attempted: invoice.attempted === true,
    attemptCount: invoice.attempt_count ?? 0,
    nextPaymentAttempt: readUnixDate(invoice.next_payment_attempt),
    lastPaymentErrorCode: readString(paymentError.code),
    lastPaymentErrorMessage: readString(paymentError.message),
    raw,
  };
}

function isInvoiceLineProration(line: Record<string, unknown>): boolean {
  const modernDetails = readRecord(readRecord(line.parent).subscription_item_details);
  const legacyDetails = readRecord(line.subscription_item_details);

  return line.proration === true
    || modernDetails.proration === true
    || legacyDetails.proration === true;
}

async function resolvePaymentMethodRecord(
  client: Stripe,
  value: unknown,
): Promise<StripeDefaultPaymentMethodRecord | null> {
  const expanded = toDefaultPaymentMethodRecord(value);
  if (expanded) return expanded;

  const paymentMethodId = readString(value) ?? readString(readRecord(value).id);
  if (!paymentMethodId) return null;

  const paymentMethod = await client.paymentMethods.retrieve(paymentMethodId);
  return toDefaultPaymentMethodRecord(paymentMethod);
}

function toDefaultPaymentMethodRecord(value: unknown): StripeDefaultPaymentMethodRecord | null {
  const paymentMethod = readRecord(value);
  if (readString(paymentMethod.object) !== 'payment_method') return null;
  if (readString(paymentMethod.type) !== 'card') return null;

  const card = readRecord(paymentMethod.card);
  const id = readString(paymentMethod.id);
  const last4 = readString(card.last4);
  if (!id || !last4) return null;

  return {
    id,
    type: 'card',
    brand: readString(card.brand),
    last4,
    expMonth: readNumber(card.exp_month),
    expYear: readNumber(card.exp_year),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    current = readRecord(current)[key];
  }
  return readString(current) ?? readString(readRecord(current).id);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStripeId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function readUnixDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}
