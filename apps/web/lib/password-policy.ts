export const passwordMinLength = Number(
  process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH ?? process.env.PASSWORD_MIN_LENGTH ?? 8,
);

export const passwordPolicyMessage =
  'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';

export const passwordPolicyRegex = new RegExp(
  `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{${String(passwordMinLength)},}$`,
);

export function isPasswordPolicyValid(password: string): boolean {
  return passwordPolicyRegex.test(password);
}
