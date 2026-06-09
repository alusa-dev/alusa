/**
 * Operational policy for resolving Asaas payments to local Alusa entities.
 *
 * The deterministic resolver is now part of the official finance flow.
 */

export type PaymentResolutionPolicyName = 'payment.webhook_deterministic_resolution';

export const PaymentResolutionPolicies: Record<
  PaymentResolutionPolicyName,
  { envKey: string; defaultValue: boolean }
> = {
  'payment.webhook_deterministic_resolution': {
    envKey: 'PAYMENT_WEBHOOK_DETERMINISTIC_RESOLUTION_ENABLED',
    defaultValue: true,
  },
};

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined || value === '') return null;
  return value === 'true' || value === '1';
}

export function isPaymentResolutionPolicyEnabled(policyName: PaymentResolutionPolicyName): boolean {
  const config = PaymentResolutionPolicies[policyName];
  const primaryValue = parseBooleanEnv(process.env[config.envKey]);
  if (primaryValue !== null) return primaryValue;

  return config.defaultValue;
}

export function getPaymentResolutionPolicies(): Record<PaymentResolutionPolicyName, boolean> {
  return {
    'payment.webhook_deterministic_resolution': isPaymentResolutionPolicyEnabled(
      'payment.webhook_deterministic_resolution',
    ),
  };
}
