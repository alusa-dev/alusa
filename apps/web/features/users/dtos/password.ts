import { z } from 'zod';

import { passwordPolicyMessage, passwordPolicyRegex } from '@/lib/password-policy';

export const changePasswordInputDTOSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: z.string().regex(passwordPolicyRegex, passwordPolicyMessage),
});

export type ChangePasswordInputDTO = z.input<typeof changePasswordInputDTOSchema>;
