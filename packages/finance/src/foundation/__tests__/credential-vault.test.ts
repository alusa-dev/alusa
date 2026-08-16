import { afterEach, describe, expect, it } from 'vitest';

import { credentialVault } from '../credential-vault';

afterEach(() => {
  delete process.env.ENCRYPTION_KEY_VERSION;
  delete process.env.ENCRYPTION_KEYRING;
});

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

  it('verifyRoundTrip deve rejeitar cifra que não representa o segredo esperado', () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

    const encrypted = credentialVault.encrypt('stored-secret');

    expect(() => credentialVault.verifyRoundTrip(encrypted, 'other-secret')).toThrow(/round-trip/i);
    expect(() => credentialVault.verifyRoundTrip(encrypted, 'stored-secret')).not.toThrow();
  });

  it('reencripta payloads antigos quando a versão ativa muda', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.ENCRYPTION_KEY_VERSION = '1';
    const encryptedWithV1 = credentialVault.encrypt('rotating-secret');

    process.env.ENCRYPTION_KEY = '1'.repeat(64);
    process.env.ENCRYPTION_KEY_VERSION = '2';
    process.env.ENCRYPTION_KEYRING = JSON.stringify({ '1': '0'.repeat(64) });

    const rotated = credentialVault.reencryptIfNeeded(encryptedWithV1);

    expect(rotated).not.toBe(encryptedWithV1);
    expect(rotated.startsWith('v3:2:')).toBe(true);
    expect(credentialVault.decrypt(rotated)).toBe('rotating-secret');

  });
});
