export const COOKIE_CONSENT_ANONYMOUS_ID_KEY = 'alusa.anonymous-id';

export function getStoredCookieConsentAnonymousId(): string | null {
  try {
    const id = window.localStorage.getItem(COOKIE_CONSENT_ANONYMOUS_ID_KEY)?.trim();
    return id && id.length >= 8 && id.length <= 128 ? id : null;
  } catch {
    return null;
  }
}
