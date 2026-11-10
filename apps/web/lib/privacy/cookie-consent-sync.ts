import { hasMarketingCookieConsent } from '@alusa/shared';
import { COOKIE_POLICY_VERSION } from './legal-versions';

export function hasSyncedMarketingCookieConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const consent = value as { policyVersion?: unknown; syncStatus?: unknown; categories?: unknown };
  return consent.policyVersion === COOKIE_POLICY_VERSION
    && consent.syncStatus === 'SYNCED'
    && hasMarketingCookieConsent(consent.categories);
}
