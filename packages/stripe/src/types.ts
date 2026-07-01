export const STRIPE_ENVIRONMENTS = ['TEST', 'LIVE'] as const;

export type StripeEnvironment = (typeof STRIPE_ENVIRONMENTS)[number];

export type StripeEnvSource = Record<string, string | undefined>;

export interface StripeRuntimeConfig {
  secretKey: string;
  environment: StripeEnvironment;
  apiVersion: string;
}
