import { z } from 'zod';

import { globalAdminLoginRequestDTOSchema } from './schemas';

export { globalAdminLoginRequestDTOSchema };

export type GlobalAdminLoginRequestDTO = z.infer<typeof globalAdminLoginRequestDTOSchema>;

export const globalAdminSessionDTOSchema = z.object({
  username: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
});

export type GlobalAdminSessionDTO = z.infer<typeof globalAdminSessionDTOSchema>;

export const globalAdminLoginResponseDTOSchema = z.object({
  success: z.literal(true),
  user: globalAdminSessionDTOSchema,
});

export type GlobalAdminLoginResponseDTO = z.infer<typeof globalAdminLoginResponseDTOSchema>;
