import { z } from 'zod';

export const globalAdminLoginRequestDTOSchema = z.object({
  username: z.string().trim().min(1, 'Usuário é obrigatório').max(128),
  password: z.string().min(1, 'Senha é obrigatória').max(256),
});

export const globalAdminSessionPayloadSchema = z.object({
  sub: z.string().min(1),
  scope: z.literal('GLOBAL_ADMIN'),
  supportUserId: z.string().optional(),
  role: z
    .enum([
      'SUPPORT_VIEWER',
      'SUPPORT_AGENT',
      'SUPPORT_FINANCE',
      'SUPPORT_DEVELOPER',
      'SUPPORT_ADMIN',
      'BREAK_GLASS',
    ])
    .optional(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
});

export const globalAdminEnvSchema = z.object({
  username: z.string().trim().min(1),
  /** Evita falhas de login quando o segredo foi colado na Vercel com newline ou espaços à volta. */
  password: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().min(1),
  ),
  sessionSecret: z.string().min(16),
});
