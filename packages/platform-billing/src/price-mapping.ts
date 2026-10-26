import { parseStripeEnvironment } from '@alusa/stripe';
import type { StripeEnvSource, StripeEnvironment } from '@alusa/stripe';
import { PlatformBillingError } from './errors';
import { PLATFORM_PLANS, isPlatformPlanCode, isPublicPlatformPlanCode } from './plans';
import type { PlatformPlanCode, PublicPlatformPlanCode } from './plans';

const PRICE_ENV_BY_PLAN = {
  BAND_001_025: 'STRIPE_PRICE_BAND_001_025_MONTHLY',
  BAND_026_050: 'STRIPE_PRICE_BAND_026_050_MONTHLY',
  BAND_051_100: 'STRIPE_PRICE_BAND_051_100_MONTHLY',
  BAND_101_150: 'STRIPE_PRICE_BAND_101_150_MONTHLY',
  BAND_151_200: 'STRIPE_PRICE_BAND_151_200_MONTHLY',
  BAND_201_300: 'STRIPE_PRICE_BAND_201_300_MONTHLY',
  BAND_301_400: 'STRIPE_PRICE_BAND_301_400_MONTHLY',
  BAND_401_500: 'STRIPE_PRICE_BAND_401_500_MONTHLY',
} as const satisfies Record<PublicPlatformPlanCode, string>;

const LEGACY_PRICE_ENV_BY_PLAN = {
  STARTER: 'STRIPE_PRICE_STARTER_MONTHLY',
  PREMIUM: 'STRIPE_PRICE_PREMIUM_MONTHLY',
  PRO: 'STRIPE_PRICE_PRO_MONTHLY',
} as const;

export interface ResolveStripePriceIdInput {
  planCode: unknown;
  environment: StripeEnvironment;
  source?: StripeEnvSource;
}

export interface ResolvedPlatformPlanFromPrice {
  planCode: PlatformPlanCode;
  environment: StripeEnvironment;
}

export function resolveStripePriceId(input: ResolveStripePriceIdInput): string {
  const publicPlanCode = isPublicPlatformPlanCode(input.planCode) ? input.planCode : null;
  const legacyPlanCode = isPlatformPlanCode(input.planCode) && input.planCode in LEGACY_PRICE_ENV_BY_PLAN
    ? input.planCode as keyof typeof LEGACY_PRICE_ENV_BY_PLAN
    : null;
  if (!publicPlanCode && !legacyPlanCode) {
    throw new PlatformBillingError('Platform plan code is invalid.', 'PLATFORM_PLAN_INVALID');
  }
  const planCode = publicPlanCode ?? legacyPlanCode!;
  const envName = publicPlanCode ? PRICE_ENV_BY_PLAN[publicPlanCode] : LEGACY_PRICE_ENV_BY_PLAN[legacyPlanCode!];
  const priceId = input.source ? input.source[envName] : process.env[envName];

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

  for (const [planCode, envName] of Object.entries({ ...PRICE_ENV_BY_PLAN, ...LEGACY_PRICE_ENV_BY_PLAN }) as Array<[PlatformPlanCode, string]>) {
    if (source[envName] === priceId) {
      return { planCode, environment };
    }
  }

  throw new PlatformBillingError('Stripe Price ID is not known.', 'PLATFORM_PRICE_UNKNOWN', { environment });
}

export function parsePublicCheckoutPlanCode(value: unknown): PublicPlatformPlanCode {
  if (!isPlatformPlanCode(value) || !(value in PRICE_ENV_BY_PLAN)) {
    throw new PlatformBillingError('Platform plan code is invalid.', 'PLATFORM_PLAN_INVALID');
  }

  const plan = PLATFORM_PLANS[value];

  if (!plan.publicCheckoutEnabled || !isPublicPlatformPlanCode(value)) {
    throw new PlatformBillingError('Platform plan is not available for public checkout.', 'PLATFORM_PLAN_NOT_PUBLIC', {
      planCode: value,
    });
  }

  return value as PublicPlatformPlanCode;
}

export function isStripePriceId(value: unknown): value is string {
  return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

export { PRICE_ENV_BY_PLAN, LEGACY_PRICE_ENV_BY_PLAN };
export type { PlatformPlanCode };
