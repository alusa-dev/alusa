export const META_MARKETING_CONSENT_POLICY_VERSION = '2026-05-27';

export type MetaMarketingConsentRecord = {
  consentAt: Date | null;
  revokedAt: Date | null;
  anonymousId: string | null;
  policyVersion: string | null;
};

export function resolveMetaMarketingConsentTransition(input: {
  previous: MetaMarketingConsentRecord;
  accepted: boolean;
  anonymousId: string | null;
  userAgent: string | null;
  now: Date;
}) {
  const currentlyGranted = Boolean(input.previous.consentAt)
    && !input.previous.revokedAt
    && input.previous.policyVersion === META_MARKETING_CONSENT_POLICY_VERSION;

  if (input.accepted && (!currentlyGranted || input.previous.anonymousId !== input.anonymousId)) {
    return {
      kind: 'GRANTED' as const,
      data: {
        metaMarketingConsentAt: input.now,
        metaMarketingConsentRevokedAt: null,
        metaMarketingConsentAnonymousId: input.anonymousId,
        metaMarketingConsentPolicyVersion: META_MARKETING_CONSENT_POLICY_VERSION,
        metaMarketingClientUserAgent: input.userAgent?.slice(0, 512) ?? null,
      },
    };
  }

  if (!input.accepted && input.previous.consentAt && !input.previous.revokedAt) {
    return {
      kind: 'REVOKED' as const,
      data: {
        metaMarketingConsentRevokedAt: input.now,
        metaMarketingConsentAnonymousId: null,
        metaMarketingClientUserAgent: null,
      },
    };
  }

  return { kind: 'UNCHANGED' as const, data: {} };
}
