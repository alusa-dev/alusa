import { describe, expect, it } from 'vitest';
import { hasMarketingCookieConsent } from './cookie-consent';

describe('hasMarketingCookieConsent', () => {
  it('requires validated categories with marketing enabled', () => {
    expect(hasMarketingCookieConsent({ essential: true, analytics: false, marketing: true, preferences: false })).toBe(true);
    expect(hasMarketingCookieConsent({ essential: true, analytics: false, marketing: false, preferences: false })).toBe(false);
    expect(hasMarketingCookieConsent({ essential: true, marketing: true })).toBe(false);
    expect(hasMarketingCookieConsent(null)).toBe(false);
  });
});
