import { describe, expect, it } from 'vitest';
import { COOKIE_POLICY_VERSION } from './legal-versions';
import { hasSyncedMarketingCookieConsent } from './cookie-consent-sync';

const categories = { essential: true, analytics: false, marketing: true, preferences: false };

describe('hasSyncedMarketingCookieConsent', () => {
  it.each(['PENDING', 'FAILED', undefined])('blocks marketing when server sync is %s', (syncStatus) => {
    expect(hasSyncedMarketingCookieConsent({ policyVersion: COOKIE_POLICY_VERSION, categories, syncStatus })).toBe(false);
  });

  it('allows only current, server-confirmed marketing consent', () => {
    expect(hasSyncedMarketingCookieConsent({ policyVersion: COOKIE_POLICY_VERSION, categories, syncStatus: 'SYNCED' })).toBe(true);
    expect(hasSyncedMarketingCookieConsent({ policyVersion: 'old-policy', categories, syncStatus: 'SYNCED' })).toBe(false);
    expect(hasSyncedMarketingCookieConsent({ policyVersion: COOKIE_POLICY_VERSION, categories: { ...categories, marketing: false }, syncStatus: 'SYNCED' })).toBe(false);
  });
});
