import { parseStripeEnvironment } from '@alusa/stripe';
import type { StripeEnvSource, StripeEnvironment } from '@alusa/stripe';
import { PlatformBillingError } from './errors';
import { PLATFORM_PLANS, isPlatformPlanCode } from './plans';
import type { PlatformPlanCode, PublicPlatformPlanCode } from './plans';

const PRICE_ENV_BY_PLAN = {
  STARTER: 'STRIPE_PRICE_STARTER_MONTHLY',
  PREMIUM: 'STRIPE_PRICE_PREMIUM_MONTHLY',
  PRO: 'STRIPE_PRICE_PRO_MONTHLY',
} as const satisfies Record<PublicPlatformPlanCode, string>;

export interface ResolveStripePriceIdInput {
  planCode: unknown;
  environment: StripeEnvironment;
  source?: StripeEnvSource;
}

export interface ResolvedPlatformPlanFromPrice {
  planCode: PublicPlatformPlanCode;
  environment: StripeEnvironment;
}

export function resolveStripePriceId(input: ResolveStripePriceIdInput): string {
  const planCode = parsePublicCheckoutPlanCode(input.planCode);
  const priceId = input.source?.[PRICE_ENV_BY_PLAN[planCode]] ?? process.env[PRICE_ENV_BY_PLAN[planCode]];

  if (!priceId) {
    throw new PlatformBillingError('Stripe Price ID is not configured for plan.', 'PLATFORM_PRICE_MISSING', {
      planCode,
      environment: input.environment,
    });
  }

  if (!isStripePriceId(priceId)) {
    throw new PlatformBillingError('Configured Stripe Price ID is invalid.', 'PLATFORM_PRICE_INVALID', {
      planCode,
      environment: input.environment,
    });
  }

  return priceId;
}

export function resolvePlanCodeFromStripePriceId(
  priceId: string,
  source: StripeEnvSource = process.env,
): ResolvedPlatformPlanFromPrice {
  if (!isStripePriceId(priceId)) {
    throw new PlatformBillingError('Stripe Price ID is invalid.', 'PLATFORM_PRICE_INVALID');
  }

  const environment = parseStripeEnvironment(source.STRIPE_ENVIRONMENT);

  for (const [planCode, envName] of Object.entries(PRICE_ENV_BY_PLAN) as Array<[PublicPlatformPlanCode, string]>) {
    if (source[envName] === priceId) {
      return { planCode, environment };
    }
  }

  throw new PlatformBillingError('Stripe Price ID is not known.', 'PLATFORM_PRICE_UNKNOWN', { environment });
}

export function parsePublicCheckoutPlanCode(value: unknown): PublicPlatformPlanCode {
  if (!isPlatformPlanCode(value)) {
    throw new PlatformBillingError('Platform plan code is invalid.', 'PLATFORM_PLAN_INVALID');
  }

  const plan = PLATFORM_PLANS[value];

  if (!plan.publicCheckoutEnabled) {
    throw new PlatformBillingError('Platform plan is not available for public checkout.', 'PLATFORM_PLAN_NOT_PUBLIC', {
      planCode: value,
    });
  }

  return value as PublicPlatformPlanCode;
}

export function isStripePriceId(value: unknown): value is string {
  return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

export { PRICE_ENV_BY_PLAN };
export type { PlatformPlanCode };
