import {
  createStripeBillingCustomer,
  createStripeBillingPortalSession,
  createStripeSubscriptionCheckoutSession,
  getStripeClient,
  previewStripeSubscriptionPlanChange,
  retrieveStripeSubscription,
  updateStripeSubscriptionCancelAtPeriodEnd,
  updateStripeSubscriptionPlan,
} from '@alusa/stripe';
import type { StripeEnvSource } from '@alusa/stripe';
import type { PlatformBillingStripeGateway } from './types';

export function createDefaultPlatformBillingStripeGateway(source?: StripeEnvSource): PlatformBillingStripeGateway {
  const client = getStripeClient(source);

  return {
    createCustomer: (input) => createStripeBillingCustomer(client, input),
    createCheckoutSession: (input) => createStripeSubscriptionCheckoutSession(client, input),
    createPortalSession: (input) => createStripeBillingPortalSession(client, input),
    retrieveSubscription: (subscriptionId) => retrieveStripeSubscription(client, subscriptionId),
    previewSubscriptionPlanChange: (input) => previewStripeSubscriptionPlanChange(client, input),
    updateSubscriptionPlan: (input) => updateStripeSubscriptionPlan(client, input),
    updateSubscriptionCancelAtPeriodEnd: (input) => updateStripeSubscriptionCancelAtPeriodEnd(client, input),
  };
}
