import { z } from 'zod';

import { COOKIE_POLICY_VERSION } from './legal-versions';

export const cookieCategoriesSchema = z
  .object({
    essential: z.literal(true).default(true),
    analytics: z.boolean().default(false),
    marketing: z.boolean().default(false),
    preferences: z.boolean().default(false),
  })
  .strict();

export const cookieConsentInputSchema = z
  .object({
    anonymousId: z.string().trim().min(8).max(128).optional(),
    categories: cookieCategoriesSchema,
    decision: z.enum(['ACCEPT_ALL', 'REJECT_NON_ESSENTIAL', 'SAVE_PREFERENCES']),
    policyVersion: z.string().default(COOKIE_POLICY_VERSION),
  })
  .strict();

export type CookieCategories = z.infer<typeof cookieCategoriesSchema>;
export type CookieConsentInput = z.infer<typeof cookieConsentInputSchema>;

export const defaultCookieCategories: CookieCategories = {
  essential: true,
  analytics: false,
  marketing: false,
  preferences: false,
};

export function hasAnalyticsConsent(categories: CookieCategories): boolean {
  return categories.analytics === true;
}
