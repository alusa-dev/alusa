import type Stripe from 'stripe';
import { getStripeClient } from './client';
import { parseStripeWebhookSecret } from './config';
import { StripeIntegrationError } from './errors';
import type { StripeEnvSource } from './types';

export type StripeWebhookEvent = Stripe.Event;

export interface ConstructStripeWebhookEventInput {
  rawBody: string;
  signature: string | null;
  source?: StripeEnvSource;
}

export function constructStripeWebhookEvent(input: ConstructStripeWebhookEventInput): StripeWebhookEvent {
  if (!input.signature) {
    throw new StripeIntegrationError('Stripe webhook signature is required.', 'STRIPE_WEBHOOK_SIGNATURE_MISSING');
  }

  const client = getStripeClient(input.source);
  const webhookSecret = parseStripeWebhookSecret(input.source);

  try {
    return client.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
  } catch {
    throw new StripeIntegrationError('Stripe webhook signature is invalid.', 'STRIPE_WEBHOOK_SIGNATURE_INVALID');
  }
}
