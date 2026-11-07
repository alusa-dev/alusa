import { describe, expect, it } from 'vitest';
import { hasCurrentMarketingConsent, metaPixelPurchaseDedupeKey, META_PIXEL_MAP_SLUGS, shouldSendMetaPixelPurchase } from '../meta-pixel';

describe('public event map Meta Pixel', () => {
  it('allows only the two configured maps', () => {
    expect([...META_PIXEL_MAP_SLUGS]).toHaveLength(2);
    expect(shouldSendMetaPixelPurchase({ publicSlug: 'another-map', mode: 'public', orderStatus: 'CONFIRMED', paymentStatus: 'RECEIVED' })).toBe(false);
    expect(shouldSendMetaPixelPurchase({ publicSlug: 'map_58c37147e01c496f92bc6f5f', mode: 'preview', orderStatus: 'CONFIRMED', paymentStatus: 'RECEIVED' })).toBe(false);
  });

  it('requires confirmed order and settled payment states', () => {
    const base = { publicSlug: 'map_58c37147e01c496f92bc6f5f', mode: 'public' as const };
    expect(shouldSendMetaPixelPurchase({ ...base, orderStatus: 'PAYMENT_PENDING', paymentStatus: 'RECEIVED' })).toBe(false);
    expect(shouldSendMetaPixelPurchase({ ...base, orderStatus: 'CONFIRMED', paymentStatus: 'PENDING' })).toBe(false);
    expect(shouldSendMetaPixelPurchase({ ...base, orderStatus: 'CONFIRMED', paymentStatus: 'RECEIVED' })).toBe(true);
  });

  it('uses an order-scoped persistent dedupe key', () => {
    expect(metaPixelPurchaseDedupeKey('order-1')).toBe('alusa.meta-pixel.purchase.order-1');
  });

  it('accepts marketing only for the current consent policy', () => {
    expect(hasCurrentMarketingConsent({ policyVersion: 'v2', categories: { marketing: true } }, 'v2')).toBe(true);
    expect(hasCurrentMarketingConsent({ policyVersion: 'v1', categories: { marketing: true } }, 'v2')).toBe(false);
    expect(hasCurrentMarketingConsent({ policyVersion: 'v2', categories: { marketing: false } }, 'v2')).toBe(false);
  });
});
