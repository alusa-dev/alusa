export const passwordMinLength = 8;

export const passwordPolicyMessage =
  'A senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';

export function isPasswordPolicyValid(password: string) {
  return password.length >= passwordMinLength
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[!@#$%^&*]/.test(password);
}
