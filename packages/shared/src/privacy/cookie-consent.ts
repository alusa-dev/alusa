import { z } from 'zod';

const cookieConsentCategoriesSchema = z.object({
  essential: z.literal(true),
  analytics: z.boolean(),
  marketing: z.boolean(),
  preferences: z.boolean(),
}).strict();

export function hasMarketingCookieConsent(categories: unknown): boolean {
  const parsed = cookieConsentCategoriesSchema.safeParse(categories);
  return parsed.success && parsed.data.marketing;
}
