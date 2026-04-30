import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { encryptSecret, decryptSecret } from './encryption';

const TEST_KEY_BASE64 = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');

describe('security/encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY_BASE64;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('encrypts and decrypts secrets using AES-256-GCM', () => {
    const secret = 'asaas_test_token_123';
    const encrypted = encryptSecret(secret);

    expect(encrypted.startsWith('v2:')).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('keeps backward compatibility with legacy v1 payloads', () => {
    const legacy = 'v1:' + Buffer.from('legacy-secret', 'utf8').toString('base64');
    expect(decryptSecret(legacy)).toBe('legacy-secret');
  });

  it('decrypts legacy database payloads (iv:salt:authTag:encrypted)', () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(64);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update('db-secret', 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const encoded = `${iv.toString('hex')}:${salt.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

    expect(decryptSecret(encoded)).toBe('db-secret');
  });

  it('throws a descriptive error when ENCRYPTION_KEY is missing', () => {
    const previous = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;

    expect(() => encryptSecret('secret')).toThrow(/ENCRYPTION_KEY/);

    process.env.ENCRYPTION_KEY = previous;
  });
});
