import { describe, expect, it } from 'vitest';
import {
  PlatformBillingError,
  parsePublicCheckoutPlanCode,
  resolvePlanCodeFromStripePriceId,
  resolveStripePriceId,
} from '../src';

const priceEnv = {
  STRIPE_ENVIRONMENT: 'TEST',
  STRIPE_PRICE_BAND_001_025_MONTHLY: 'price_band_001_025_test',
  STRIPE_PRICE_BAND_026_050_MONTHLY: 'price_band_026_050_test',
  STRIPE_PRICE_BAND_051_100_MONTHLY: 'price_band_051_100_test',
  STRIPE_PRICE_BAND_101_150_MONTHLY: 'price_band_101_150_test',
  STRIPE_PRICE_BAND_151_200_MONTHLY: 'price_band_151_200_test',
  STRIPE_PRICE_BAND_201_300_MONTHLY: 'price_band_201_300_test',
  STRIPE_PRICE_BAND_301_400_MONTHLY: 'price_band_301_400_test',
  STRIPE_PRICE_BAND_401_500_MONTHLY: 'price_band_401_500_test',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_legacy_starter',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_legacy_premium',
  STRIPE_PRICE_PRO_MONTHLY: 'price_legacy_pro',
};

describe('@alusa/platform-billing Stripe Price mapping', () => {
  it('resolves approved band prices for new subscriptions', () => {
    expect(resolveStripePriceId({ planCode: 'BAND_001_025', environment: 'TEST', source: priceEnv }))
      .toBe('price_band_001_025_test');
    expect(resolveStripePriceId({ planCode: 'BAND_401_500', environment: 'TEST', source: priceEnv }))
      .toBe('price_band_401_500_test');
    expect(resolvePlanCodeFromStripePriceId('price_band_026_050_test', priceEnv)).toEqual({
      planCode: 'BAND_026_050', environment: 'TEST',
    });
  });

  it('maps old prices only for webhook reconciliation and rejects old checkout codes', () => {
    expect(resolvePlanCodeFromStripePriceId('price_legacy_starter', priceEnv)).toEqual({
      planCode: 'STARTER', environment: 'TEST',
    });
    expect(() => parsePublicCheckoutPlanCode('STARTER')).toThrow(PlatformBillingError);
  });

  it('rejects unknown prices and plan codes', () => {
    expect(() => resolvePlanCodeFromStripePriceId('price_unknown', priceEnv)).toThrow(PlatformBillingError);
    expect(() => resolveStripePriceId({ planCode: 'UNKNOWN', environment: 'TEST', source: priceEnv })).toThrow(PlatformBillingError);
  });

  it('fails closed when a configured band price is missing or invalid', () => {
    expect(() => resolveStripePriceId({ planCode: 'BAND_001_025', environment: 'TEST', source: { STRIPE_ENVIRONMENT: 'TEST' } }))
      .toThrow(PlatformBillingError);
    expect(() => resolveStripePriceId({
      planCode: 'BAND_001_025', environment: 'TEST',
      source: { STRIPE_ENVIRONMENT: 'TEST', STRIPE_PRICE_BAND_001_025_MONTHLY: 'not-a-price' },
    })).toThrow(PlatformBillingError);
  });

  it('does not accept arbitrary Price IDs from callers', () => {
    expect(() => resolvePlanCodeFromStripePriceId('price_frontend_supplied', priceEnv)).toThrow(PlatformBillingError);
  });
});
