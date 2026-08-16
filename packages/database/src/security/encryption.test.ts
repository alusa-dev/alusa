import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';

import { decryptSecret, decryptSecretWithMetadata, encryptSecret, validateEncryptionConfiguration } from './encryption';

const KEY_V1 = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');
const KEY_V2 = Buffer.from('fedcba9876543210fedcba9876543210', 'utf8').toString('base64');

describe('database secret encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_V1;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete process.env.ENCRYPTION_KEYRING;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete process.env.ENCRYPTION_KEYRING;
  });

  it('grava payloads AES-256-GCM versionados e autentica o conteúdo', () => {
    const encrypted = encryptSecret('asaas-secret');

    expect(encrypted.startsWith('v3:1:')).toBe(true);
    expect(decryptSecret(encrypted)).toBe('asaas-secret');
  });

  it('aceita rotação com keyring sem expor a chave anterior', () => {
    process.env.ENCRYPTION_KEY_VERSION = '1';
    const encryptedWithV1 = encryptSecret('rotating-secret');

    process.env.ENCRYPTION_KEY = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = '2';
    process.env.ENCRYPTION_KEYRING = JSON.stringify({ '1': KEY_V1 });

    expect(decryptSecretWithMetadata(encryptedWithV1)).toEqual({
      value: 'rotating-secret',
      keyVersion: '1',
      needsRotation: true,
    });
    expect(validateEncryptionConfiguration()).toEqual({ activeVersion: '2', keyVersions: ['2', '1'] });
  });

  it('mantém leitura de payload legado e marca necessidade de rotação', () => {
    const legacy = `v1:${Buffer.from('legacy-secret', 'utf8').toString('base64')}`;

    expect(decryptSecretWithMetadata(legacy)).toEqual({
      value: 'legacy-secret',
      keyVersion: null,
      needsRotation: true,
    });
  });

  it('lê payload legado com chave anterior durante a rotação', () => {
    const key = Buffer.from(KEY_V1, 'base64');
    const iv = randomBytes(16);
    const salt = randomBytes(64);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update('legacy-rotating-secret', 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const legacy = `${iv.toString('hex')}:${salt.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext}`;

    process.env.ENCRYPTION_KEY = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = '2';
    process.env.ENCRYPTION_KEYRING = JSON.stringify({ '1': KEY_V1 });

    expect(decryptSecretWithMetadata(legacy)).toMatchObject({
      value: 'legacy-rotating-secret',
      keyVersion: '1',
      needsRotation: true,
    });
  });

  it('não aceita payload versionado adulterado', () => {
    const encrypted = encryptSecret('protected-secret');
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('0') ? '1' : '0'}`;

    expect(decryptSecret(tampered)).toBeNull();
  });

  it('falha explicitamente para keyring inválido', () => {
    process.env.ENCRYPTION_KEYRING = '{invalid';

    expect(() => validateEncryptionConfiguration()).toThrow(/ENCRYPTION_KEYRING/);
  });
});
