import { COOKIE_POLICY_VERSION } from './legal-versions';
import type { CookieCategories } from './cookie-consent';

export const COOKIE_CONSENT_STORAGE_KEY = 'alusa.cookie-consent.v1';
export const COOKIE_CONSENT_UPDATED_EVENT = 'alusa-cookie-consent-updated';

type ConsentDecision = 'ACCEPT_ALL' | 'REJECT_NON_ESSENTIAL' | 'SAVE_PREFERENCES';
type StoredConsent = {
  policyVersion: string;
  categories: CookieCategories;
  decidedAt: string;
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
};

function saveLocalPreference(consent: StoredConsent) {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // The in-memory event still updates the active page; persistence is unavailable.
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_UPDATED_EVENT, { detail: consent }));
}

export async function persistCookieConsentForClient(input: {
  categories: CookieCategories;
  decision: ConsentDecision;
  anonymousId: string;
}): Promise<boolean> {
  const pending: StoredConsent = {
    policyVersion: COOKIE_POLICY_VERSION,
    categories: input.categories,
    decidedAt: new Date().toISOString(),
    syncStatus: 'PENDING',
  };
  saveLocalPreference(pending);

  try {
    const response = await fetch('/api/privacy/cookie-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousId: input.anonymousId,
        categories: input.categories,
        decision: input.decision,
        policyVersion: COOKIE_POLICY_VERSION,
      }),
    });
    if (!response.ok) throw new Error('COOKIE_CONSENT_SYNC_FAILED');
    saveLocalPreference({ ...pending, syncStatus: 'SYNCED' });
    return true;
  } catch {
    saveLocalPreference({ ...pending, syncStatus: 'FAILED' });
    return false;
  }
}
