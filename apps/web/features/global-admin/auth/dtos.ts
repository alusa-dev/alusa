import { z } from 'zod';

import { globalAdminLoginRequestDTOSchema } from './schemas';

export { globalAdminLoginRequestDTOSchema };

export const globalAdminSessionDTOSchema = z.object({
  username: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  supportUserId: z.string().nullable().optional(),
  role: z.enum([
    'SUPPORT_VIEWER',
    'SUPPORT_AGENT',
    'SUPPORT_FINANCE',
    'SUPPORT_DEVELOPER',
    'SUPPORT_ADMIN',
    'BREAK_GLASS',
  ]),
});

export const globalAdminLoginResponseDTOSchema = z.object({
  success: z.literal(true),
  user: globalAdminSessionDTOSchema,
});
