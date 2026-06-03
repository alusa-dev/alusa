import { randomUUID } from 'node:crypto';
import { sha256Hex } from '@alusa/domain';

export function createPublicContractToken(): { token: string; tokenHash: string } {
  const token = randomUUID();
  return { token, tokenHash: hashPublicContractToken(token) };
}

export function hashPublicContractToken(token: string): string {
  return sha256Hex(token);
}
