import Stripe from 'stripe';
import { parseStripeRuntimeConfig } from './config';
import { StripeIntegrationError } from './errors';
import type { StripeEnvSource, StripeRuntimeConfig } from './types';

let stripeClient: Stripe | null = null;
let stripeClientCacheKey: string | null = null;
type StripeClientOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;

export function getStripeClient(source?: StripeEnvSource): Stripe {
  assertServerRuntime();

  const config = parseStripeRuntimeConfig(source);
  const cacheKey = buildClientCacheKey(config);

  if (!stripeClient || stripeClientCacheKey !== cacheKey) {
    stripeClient = new Stripe(config.secretKey, {
      apiVersion: config.apiVersion as StripeClientOptions['apiVersion'],
    });
    stripeClientCacheKey = cacheKey;
  }

  return stripeClient;
}

export function resetStripeClientForTests(): void {
  stripeClient = null;
  stripeClientCacheKey = null;
}

function assertServerRuntime(): void {
  if (typeof window !== 'undefined') {
    throw new StripeIntegrationError('Stripe client is server-only.', 'STRIPE_SERVER_ONLY');
  }
}

function buildClientCacheKey(config: StripeRuntimeConfig): string {
  return `${config.environment}:${config.apiVersion}:${config.secretKey.slice(0, 8)}`;
}
