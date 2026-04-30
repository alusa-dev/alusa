import { describe, expect, it } from 'vitest';

import { credentialVault } from '../credential-vault';

describe('credentialVault', () => {
  it('encrypt/decrypt deve ser reversível', () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

    const secret = 'super-secret-value';
    const encrypted = credentialVault.encrypt(secret);

    expect(encrypted).not.toEqual(secret);
    expect(credentialVault.decrypt(encrypted)).toEqual(secret);
  });

  it('decrypt deve falhar para valor inválido', () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

    expect(() => credentialVault.decrypt('invalid')).toThrow(/descriptografar/i);
  });
});
