import { z } from 'zod';
import { authRegisterInputSchema } from '@/lib/dtos/auth-register.dto';

export * from './profile';
export * from './invites';
export * from './management';
export { changePasswordInputDTOSchema } from './password';
export type { ChangePasswordInputDTO } from './password';

export const disabledRegisterResultDTOSchema = z.object({ error: z.string() });
export type DisabledRegisterResultDTO = z.infer<typeof disabledRegisterResultDTOSchema>;

export const firstRegisterInputDTOSchema = authRegisterInputSchema;
export type FirstRegisterInputDTO = z.input<typeof firstRegisterInputDTOSchema>;

export const firstRegisterResultDTOSchema = z.object({
  verificationRequired: z.boolean(),
  verificationEmailSent: z.boolean(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    contaId: z.string(),
    emailVerified: z.boolean(),
  }),
});
export type FirstRegisterResultDTO = z.infer<typeof firstRegisterResultDTOSchema>;
