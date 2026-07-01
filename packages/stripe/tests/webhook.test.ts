import { describe, expect, it } from 'vitest';
import { StripeIntegrationError, parseStripeWebhookSecret } from '../src';

describe('@alusa/stripe webhook config', () => {
  it('gera erro seguro quando webhook secret está ausente', () => {
    expect(() => parseStripeWebhookSecret({})).toThrow(StripeIntegrationError);
  });

  it('retorna webhook secret somente quando função específica é chamada', () => {
    expect(
      parseStripeWebhookSecret({
        STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      }),
    ).toBe('whsec_test_secret');
  });
});
