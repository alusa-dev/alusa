import bcrypt from 'bcryptjs';
import {
  passwordPolicyMessage,
  passwordPolicyRegex,
} from './password-policy';

export { passwordMinLength, passwordPolicyMessage, passwordPolicyRegex } from './password-policy';

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

export async function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  const pepper = process.env.BCRYPT_PEPPER || '';
  return bcrypt.compare(password + pepper, passwordHash);
}
