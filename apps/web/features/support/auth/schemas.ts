import { z } from 'zod';

export const supportRoleSchema = z.enum([
  'SUPPORT_VIEWER',
  'SUPPORT_AGENT',
  'SUPPORT_FINANCE',
  'SUPPORT_DEVELOPER',
  'SUPPORT_ADMIN',
  'BREAK_GLASS',
]);

export const createSupportUserSchema = z.object({
  username: z.string().trim().min(3).max(80),
  email: z.string().email().optional().nullable(),
  password: z.string().min(10).max(256),
  role: supportRoleSchema,
  breakGlassExpiresAt: z.coerce.date().optional().nullable(),
});

export const updateSupportUserSchema = z.object({
  role: supportRoleSchema.optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  breakGlassExpiresAt: z.coerce.date().optional().nullable(),
});
