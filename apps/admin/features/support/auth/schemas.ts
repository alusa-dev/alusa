import { z } from 'zod';

export const supportRoleSchema = z.enum([
  'SUPPORT_VIEWER',
  'SUPPORT_AGENT',
  'SUPPORT_FINANCE',
  'SUPPORT_DEVELOPER',
  'SUPPORT_ADMIN',
  'BREAK_GLASS',
]);

export const createSupportUserSchema = z
  .object({
    username: z.string().trim().min(3).max(80),
    email: z.string().email().optional().nullable(),
    password: z.string().min(10).max(256),
    role: supportRoleSchema,
    breakGlassExpiresAt: z.coerce.date().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'BREAK_GLASS' && (!value.breakGlassExpiresAt || value.breakGlassExpiresAt <= new Date())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['breakGlassExpiresAt'],
        message: 'Acesso break-glass exige uma expiração futura.',
      });
    }

    if (value.role !== 'BREAK_GLASS' && value.breakGlassExpiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['breakGlassExpiresAt'],
        message: 'Expiração break-glass só pode ser usada com o papel BREAK_GLASS.',
      });
    }
  });

export const updateSupportUserSchema = z.object({
  role: supportRoleSchema.optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  breakGlassExpiresAt: z.coerce.date().optional().nullable(),
});

