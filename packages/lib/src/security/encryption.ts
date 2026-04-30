// Criptografia de segredos usando AES-256-GCM com suporte a payloads legacy v1.
// v1: base64 simples; v2: AES-256-GCM com chave em base64 em ENCRYPTION_KEY.

import crypto from 'crypto';

const LEGACY_PREFIX = 'v1:';
const PREFIX_V2 = 'v2:';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY não configurada');
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY inválida: esperado 32 bytes (hex 64 chars ou base64)');
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96 bits recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  return PREFIX_V2 + payload;
}

export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;

  // Compatibilidade com payloads legacy v1
  if (encoded.startsWith(LEGACY_PREFIX)) {
    const b64 = encoded.slice(LEGACY_PREFIX.length);
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  if (encoded.startsWith(PREFIX_V2)) {
    const key = getKey();
    const b64 = encoded.slice(PREFIX_V2.length);
    const buf = Buffer.from(b64, 'base64');

    if (buf.length < 12 + 16) {
      return null;
    }

    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

  // Compatibilidade com payloads legacy (packages/database): iv:salt:authTag:encrypted
  const parts = encoded.split(':');
  if (parts.length !== 4) {
    return null;
  }
  const [ivHex, , authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    return null;
  }

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}
