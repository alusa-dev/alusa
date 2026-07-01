import { z } from 'zod';
import { StripeIntegrationError } from './errors';
import type { StripeEnvSource, StripeEnvironment, StripeRuntimeConfig } from './types';

export const DEFAULT_STRIPE_API_VERSION = '2026-06-24.dahlia';

const stripeEnvironmentSchema = z
  .string({ required_error: 'STRIPE_ENVIRONMENT is required' })
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(['TEST', 'LIVE']));

const stripeSecretKeySchema = z
  .string({ required_error: 'STRIPE_SECRET_KEY is required' })
  .trim()
  .min(1, 'STRIPE_SECRET_KEY is required');

const stripeRuntimeConfigSchema = z.object({
  STRIPE_SECRET_KEY: stripeSecretKeySchema,
  STRIPE_ENVIRONMENT: stripeEnvironmentSchema,
  STRIPE_API_VERSION: z.string().trim().min(1).optional(),
});

const stripeWebhookSecretSchema = z
  .string({ required_error: 'STRIPE_WEBHOOK_SECRET is required' })
  .trim()
  .min(1, 'STRIPE_WEBHOOK_SECRET is required');

export function parseStripeEnvironment(value: unknown): StripeEnvironment {
  const parsed = stripeEnvironmentSchema.safeParse(value);

  if (!parsed.success) {
    throw new StripeIntegrationError('Invalid Stripe environment.', 'STRIPE_CONFIG_INVALID', {
      field: 'STRIPE_ENVIRONMENT',
    });
  }

  return parsed.data;
}

export function parseStripeRuntimeConfig(source: StripeEnvSource = process.env): StripeRuntimeConfig {
  const parsed = stripeRuntimeConfigSchema.safeParse(source);

  if (!parsed.success) {
    const missingSecret = parsed.error.issues.some((issue) => issue.path.includes('STRIPE_SECRET_KEY'));
    throw new StripeIntegrationError(
      missingSecret ? 'Stripe secret key is required.' : 'Stripe configuration is invalid.',
      missingSecret ? 'STRIPE_CONFIG_MISSING' : 'STRIPE_CONFIG_INVALID',
      { fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean) },
    );
  }

  assertSecretMatchesEnvironment(parsed.data.STRIPE_SECRET_KEY, parsed.data.STRIPE_ENVIRONMENT);

  return {
    secretKey: parsed.data.STRIPE_SECRET_KEY,
    environment: parsed.data.STRIPE_ENVIRONMENT,
    apiVersion: parsed.data.STRIPE_API_VERSION ?? DEFAULT_STRIPE_API_VERSION,
  };
}

export function parseStripeWebhookSecret(source: StripeEnvSource = process.env): string {
  const parsed = stripeWebhookSecretSchema.safeParse(source.STRIPE_WEBHOOK_SECRET);

  if (!parsed.success) {
    throw new StripeIntegrationError('Stripe webhook secret is required.', 'STRIPE_CONFIG_MISSING', {
      field: 'STRIPE_WEBHOOK_SECRET',
    });
  }

  return parsed.data;
}

function assertSecretMatchesEnvironment(secretKey: string, environment: StripeEnvironment): void {
  const isTestKey = secretKey.startsWith('sk_test_');
  const isLiveKey = secretKey.startsWith('sk_live_');

  if ((environment === 'TEST' && isLiveKey) || (environment === 'LIVE' && isTestKey)) {
    throw new StripeIntegrationError(
      'Stripe secret key does not match STRIPE_ENVIRONMENT.',
      'STRIPE_ENVIRONMENT_MISMATCH',
      { environment },
    );
  }
}
