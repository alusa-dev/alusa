import { describe, expect, it } from 'vitest';
import { META_MARKETING_CONSENT_POLICY_VERSION, resolveMetaMarketingConsentTransition } from './meta-marketing-consent';

describe('public event map Meta marketing consent transitions', () => {
  it('records grant, revocation, and regrant as distinct active transitions', () => {
    const grantedAt = new Date('2026-11-10T12:00:00Z');
    const revokedAt = new Date('2026-11-10T12:05:00Z');
    const regrantedAt = new Date('2026-11-10T12:10:00Z');
    const empty = { consentAt: null, revokedAt: null, anonymousId: null, policyVersion: null };

    const grant = resolveMetaMarketingConsentTransition({
      previous: empty, accepted: true, anonymousId: 'anonymous-123', userAgent: 'UA', now: grantedAt,
    });
    expect(grant).toMatchObject({ kind: 'GRANTED', data: {
      metaMarketingConsentAt: grantedAt,
      metaMarketingConsentAnonymousId: 'anonymous-123',
      metaMarketingConsentPolicyVersion: META_MARKETING_CONSENT_POLICY_VERSION,
    } });

    const revoke = resolveMetaMarketingConsentTransition({
      previous: { consentAt: grantedAt, revokedAt: null, anonymousId: 'anonymous-123', policyVersion: META_MARKETING_CONSENT_POLICY_VERSION },
      accepted: false, anonymousId: null, userAgent: null, now: revokedAt,
    });
    expect(revoke).toMatchObject({ kind: 'REVOKED', data: {
      metaMarketingConsentRevokedAt: revokedAt,
      metaMarketingConsentAnonymousId: null,
      metaMarketingClientUserAgent: null,
    } });

    const regrant = resolveMetaMarketingConsentTransition({
      previous: { consentAt: grantedAt, revokedAt, anonymousId: null, policyVersion: META_MARKETING_CONSENT_POLICY_VERSION },
      accepted: true, anonymousId: 'anonymous-123', userAgent: 'UA2', now: regrantedAt,
    });
    expect(regrant).toMatchObject({ kind: 'GRANTED', data: {
      metaMarketingConsentAt: regrantedAt,
      metaMarketingConsentRevokedAt: null,
      metaMarketingClientUserAgent: 'UA2',
    } });
  });
});
