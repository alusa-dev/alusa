import { z } from 'zod';

export const globalAdminLoginRequestDTOSchema = z.object({
  username: z.string().trim().min(1, 'Usuário é obrigatório').max(128),
  password: z.string().min(1, 'Senha é obrigatória').max(256),
});

export const globalAdminSessionPayloadSchema = z.object({
  sub: z.string().min(1),
  scope: z.literal('GLOBAL_ADMIN'),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
});

export const globalAdminEnvSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  sessionSecret: z.string().min(16),
});

export const globalAdminAuditFilterSchema = z.object({
  tenantId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  status: z.enum(['SUCCESS', 'ERROR']).optional(),
  actorIdentifier: z.string().trim().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
