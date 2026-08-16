// Criptografia de segredos com AES-256-GCM e payloads versionados.
// Payloads v1/v2 e o formato legado do @alusa/database continuam aceitos.

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const LEGACY_PREFIX = 'v1:';
const PREFIX_V2 = 'v2:';
const PREFIX_V3 = 'v3:';
const DEFAULT_KEY_VERSION = '1';
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;
const AAD_PREFIX = 'alusa-secret-v3:';

type KeyRing = { activeVersion: string; keys: Map<string, Buffer> };

function parseKey(raw: string, source: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`${source} inválida: esperado 32 bytes (hex 64 chars ou base64)`);
  }
  return key;
}

function getKeyRing(): KeyRing {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY não configurada');

  const activeVersion = process.env.ENCRYPTION_KEY_VERSION?.trim() || DEFAULT_KEY_VERSION;
  if (!KEY_VERSION_PATTERN.test(activeVersion)) {
    throw new Error('ENCRYPTION_KEY_VERSION inválida');
  }

  const keys = new Map<string, Buffer>([[activeVersion, parseKey(raw, 'ENCRYPTION_KEY')]]);
  const keyRingRaw = process.env.ENCRYPTION_KEYRING?.trim();
  if (!keyRingRaw) return { activeVersion, keys };

  let parsed: unknown;
  try {
    parsed = JSON.parse(keyRingRaw);
  } catch {
    throw new Error('ENCRYPTION_KEYRING inválido: esperado um objeto JSON com versões e chaves');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ENCRYPTION_KEYRING inválido: esperado um objeto JSON com versões e chaves');
  }

  for (const [version, value] of Object.entries(parsed)) {
    if (!KEY_VERSION_PATTERN.test(version) || typeof value !== 'string') {
      throw new Error('ENCRYPTION_KEYRING contém uma versão ou chave inválida');
    }
    const key = parseKey(value, `ENCRYPTION_KEYRING[${version}]`);
    const existing = keys.get(version);
    if (existing && !existing.equals(key)) {
      throw new Error(`ENCRYPTION_KEYRING conflita com ENCRYPTION_KEY na versão ${version}`);
    }
    keys.set(version, key);
  }

  return { activeVersion, keys };
}

function getAad(version: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${version}`, 'utf8');
}

function decryptV3(encoded: string): string | null {
  const [, version, ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  if (!version || !KEY_VERSION_PATTERN.test(version) || !ivHex || !authTagHex || !ciphertextHex) return null;

  const { keys } = getKeyRing();
  const key = keys.get(version);
  if (!key) return null;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(getAad(version));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function decryptLegacy(encoded: string): string | null {
  if (encoded.startsWith(LEGACY_PREFIX)) {
    try {
      return Buffer.from(encoded.slice(LEGACY_PREFIX.length), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  if (encoded.startsWith(PREFIX_V2)) {
    const { keys } = getKeyRing();

    const buf = Buffer.from(encoded.slice(PREFIX_V2.length), 'base64');
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    if (ciphertext.length === 0) return null;

    for (const key of keys.values()) {
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        // Tenta a próxima versão somente para payloads legados sem metadado de chave.
      }
    }
    return null;
  }

  // Compatibilidade com payload legado do @alusa/database: iv:salt:authTag:encrypted.
  const parts = encoded.split(':');
  if (parts.length !== 4) return null;
  const [ivHex, , authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) return null;

  const { keys } = getKeyRing();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  if (iv.length === 0 || authTag.length !== AUTH_TAG_LENGTH) return null;

  for (const key of keys.values()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      // Tenta a próxima versão somente para payloads legados sem metadado de chave.
    }
  }
  return null;
}

export function encryptSecret(plain: string): string {
  const { activeVersion, keys } = getKeyRing();
  const key = keys.get(activeVersion);
  if (!key) throw new Error(`Chave ativa não encontrada para a versão ${activeVersion}`);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(getAad(activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [PREFIX_V3.slice(0, -1), activeVersion, iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  if (encoded.startsWith(PREFIX_V3)) return decryptV3(encoded);
  return decryptLegacy(encoded);
}
