import bcrypt from 'bcryptjs';

export const passwordMinLength = Number(process.env.PASSWORD_MIN_LENGTH || 8);
export const passwordPolicyMessage =
  'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';
export const passwordPolicyRegex = new RegExp(
  `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{${String(passwordMinLength)},}$`,
);

export function assertPasswordPolicy(password: string): void {
  if (!passwordPolicyRegex.test(password)) {
    throw new Error(passwordPolicyMessage);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const pepper = process.env.BCRYPT_PEPPER || '';
  return bcrypt.hash(password + pepper, rounds);
}
