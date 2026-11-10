import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_POLICY_VERSION } from './legal-versions';
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_UPDATED_EVENT, persistCookieConsentForClient } from './persist-cookie-consent-client';

const accepted = { essential: true, analytics: false, marketing: true, preferences: false } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('persistCookieConsentForClient', () => {
  it('applies the local preference immediately and marks it synced only after a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const statuses: string[] = [];
    window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, (event) => {
      statuses.push((event as CustomEvent<{ syncStatus: string }>).detail.syncStatus);
    });

    const pending = persistCookieConsentForClient({ categories: accepted, decision: 'SAVE_PREFERENCES', anonymousId: 'anonymous-123' });
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      policyVersion: COOKIE_POLICY_VERSION, categories: accepted, syncStatus: 'PENDING',
    });
    await expect(pending).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? 'null').syncStatus).toBe('SYNCED');
    expect(statuses).toEqual(['PENDING', 'SYNCED']);
  });

  it('keeps the chosen local state but records failed sync without claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(persistCookieConsentForClient({ categories: accepted, decision: 'SAVE_PREFERENCES', anonymousId: 'anonymous-123' })).resolves.toBe(false);
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? 'null')).toMatchObject({
      policyVersion: COOKIE_POLICY_VERSION, categories: accepted, syncStatus: 'FAILED',
    });
  });
});
