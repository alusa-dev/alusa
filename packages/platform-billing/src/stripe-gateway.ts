import {
  createStripeBillingCustomer,
  createStripeBillingPortalSession,
  retrieveStripeCheckoutSession,
  expireStripeCheckoutSession,
  createStripeSubscriptionCheckoutSession,
  createStripeTrialSubscriptionWithoutPaymentMethod,
  getStripeMissingCustomerId,
  getStripeClient,
  previewStripeSubscriptionPlanChange,
  retrieveStripeCustomer,
  retrieveStripeSubscription,
  cancelStripeSubscription,
  releaseStripeSubscriptionSchedule,
  scheduleStripeSubscriptionPlanChange,
  updateStripeSubscriptionCancelAtPeriodEnd,
  updateStripeSubscriptionPlan,
} from '@alusa/stripe';
import type { StripeEnvSource } from '@alusa/stripe';
import type { PlatformBillingStripeGateway } from './types';

export function createDefaultPlatformBillingStripeGateway(source?: StripeEnvSource): PlatformBillingStripeGateway {
  const client = getStripeClient(source);

  return {
    listCustomerSubscriptions: async (customerId) => {
      const page = await client.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      return {
        complete: !page.has_more,
        subscriptions: page.data.map((subscription) => ({
          id: subscription.id,
          customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
          status: subscription.status,
          livemode: subscription.livemode,
          metadata: subscription.metadata ?? {},
          priceIds: subscription.items.data.flatMap((item) => {
            const priceId = typeof item.price === 'string' ? item.price : item.price.id;
            return priceId ? [priceId] : [];
          }),
        })),
      };
    },
    createCustomer: (input) => createStripeBillingCustomer(client, input),
    createCheckoutSession: (input) => createStripeSubscriptionCheckoutSession(client, input),
    retrieveCheckoutSession: (id) => retrieveStripeCheckoutSession(client, id),
    expireCheckoutSession: (id) => expireStripeCheckoutSession(client, id),
    createTrialSubscriptionWithoutPaymentMethod: (input) =>
      createStripeTrialSubscriptionWithoutPaymentMethod(client, input),
    createPortalSession: (input) => createStripeBillingPortalSession(client, input),
    retrieveSubscription: (subscriptionId) => retrieveStripeSubscription(client, subscriptionId),
    cancelSubscription: (subscriptionId, idempotencyKey) =>
      cancelStripeSubscription(client, subscriptionId, idempotencyKey),
    retrieveSubscriptionSnapshot: async (subscriptionId) => {
      const subscription = await client.subscriptions.retrieve(subscriptionId);
      const singleItem = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined;
      const rootPeriodEnd = (subscription as unknown as { current_period_end?: unknown }).current_period_end;
      const itemPeriodEnd = (singleItem as unknown as { current_period_end?: unknown } | undefined)?.current_period_end;
      const periodEnd = typeof rootPeriodEnd === 'number'
        ? rootPeriodEnd
        : typeof itemPeriodEnd === 'number' ? itemPeriodEnd : null;
      return {
        id: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        status: subscription.status,
        livemode: subscription.livemode,
        metadata: subscription.metadata ?? {},
        priceIds: subscription.items.data.flatMap((item) => {
          const priceId = typeof item.price === 'string' ? item.price : item.price.id;
          return priceId ? [priceId] : [];
        }),
        currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      };
    },
    retrieveLatestSubscriptionInvoice: async (subscriptionId) => {
      const subscription = await client.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
      const latestInvoice = (subscription as unknown as { latest_invoice?: string | { id?: string } | null }).latest_invoice;
      const invoiceId = typeof latestInvoice === 'string' ? latestInvoice : latestInvoice?.id;
      if (!invoiceId) return null;
      const invoice = typeof latestInvoice === 'object' && latestInvoice !== null && 'status' in latestInvoice
        ? latestInvoice
        : await client.invoices.retrieve(invoiceId);
      return invoice as unknown as Record<string, unknown>;
    },
    retrieveCustomer: async (customerId) => {
      try {
        return await retrieveStripeCustomer(client, customerId);
      } catch (error) {
        if (getStripeMissingCustomerId(error) === customerId) {
          return { id: customerId, deleted: true };
        }
        throw error;
      }
    },
    previewSubscriptionPlanChange: (input) => previewStripeSubscriptionPlanChange(client, input),
    updateSubscriptionPlan: (input) => updateStripeSubscriptionPlan(client, input),
    scheduleSubscriptionPlanChange: (input) => scheduleStripeSubscriptionPlanChange(client, input),
    releaseSubscriptionSchedule: (input) => releaseStripeSubscriptionSchedule(client, input),
    updateSubscriptionCancelAtPeriodEnd: (input) => updateStripeSubscriptionCancelAtPeriodEnd(client, input),
  };
}
