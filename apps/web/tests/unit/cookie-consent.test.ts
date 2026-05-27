import { describe, expect, it } from 'vitest';

import {
  cookieConsentInputSchema,
  defaultCookieCategories,
  hasAnalyticsConsent,
} from '@/lib/privacy/cookie-consent';

describe('cookie consent', () => {
  it('mantem categorias nao essenciais desligadas por padrao', () => {
    expect(defaultCookieCategories).toEqual({
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
    expect(hasAnalyticsConsent(defaultCookieCategories)).toBe(false);
  });

  it('valida consentimento explicito por categoria', () => {
    const parsed = cookieConsentInputSchema.parse({
      anonymousId: 'anonymous-user',
      decision: 'SAVE_PREFERENCES',
      categories: {
        essential: true,
        analytics: true,
        marketing: false,
        preferences: false,
      },
    });

    expect(hasAnalyticsConsent(parsed.categories)).toBe(true);
  });
});
