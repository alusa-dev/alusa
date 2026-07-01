import { describe, expect, it } from 'vitest';
import {
  PlatformBillingError,
  resolvePlanCodeFromStripePriceId,
  resolveStripePriceId,
} from '../src';

const priceEnv = {
  STRIPE_ENVIRONMENT: 'TEST',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
};

describe('@alusa/platform-billing Stripe Price mapping', () => {
  it('resolve STARTER, PREMIUM e PRO para Price IDs configurados', () => {
    expect(resolveStripePriceId({ planCode: 'STARTER', environment: 'TEST', source: priceEnv })).toBe(
      'price_starter_test',
    );
    expect(resolveStripePriceId({ planCode: 'PREMIUM', environment: 'TEST', source: priceEnv })).toBe(
      'price_premium_test',
    );
    expect(resolveStripePriceId({ planCode: 'PRO', environment: 'TEST', source: priceEnv })).toBe('price_pro_test');
  });

  it('rejeita Price desconhecido', () => {
    expect(() => resolvePlanCodeFromStripePriceId('price_unknown', priceEnv)).toThrow(PlatformBillingError);
  });

  it('rejeita plano desconhecido', () => {
    expect(() => resolveStripePriceId({ planCode: 'UNKNOWN', environment: 'TEST', source: priceEnv })).toThrow(
      PlatformBillingError,
    );
  });

  it('rejeita Price ausente somente quando solicitado', () => {
    expect(() =>
      resolveStripePriceId({
        planCode: 'PRO',
        environment: 'TEST',
        source: {
          STRIPE_ENVIRONMENT: 'TEST',
          STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
          STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
        },
      }),
    ).toThrow(PlatformBillingError);
  });

  it('não aceita Price arbitrário vindo do caller', () => {
    expect(() => resolvePlanCodeFromStripePriceId('price_frontend_supplied', priceEnv)).toThrow(PlatformBillingError);
  });

  it('resolve inverso com ambiente', () => {
    expect(resolvePlanCodeFromStripePriceId('price_premium_test', priceEnv)).toEqual({
      planCode: 'PREMIUM',
      environment: 'TEST',
    });
  });
});
