import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const LEGACY_PREFIX_V1 = 'v1:';
const LEGACY_PREFIX_V2 = 'v2:';
const VERSIONED_PREFIX = 'v3:';
const DEFAULT_KEY_VERSION = '1';
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;
const AAD_PREFIX = 'alusa-secret-v3:';

export type DecryptedSecret = {
  value: string;
  keyVersion: string | null;
  needsRotation: boolean;
};

type KeyRing = {
  activeVersion: string;
  keys: Map<string, Buffer>;
};

function parseKey(raw: string, source: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');

  if (key.length !== 32) {
    throw new Error(`${source} inválida: esperado 32 bytes (hex 64 chars ou base64)`);
  }

  return key;
}

function parseKeyVersion(raw: string | undefined): string {
  const version = raw?.trim() || DEFAULT_KEY_VERSION;
  if (!KEY_VERSION_PATTERN.test(version)) {
    throw new Error('ENCRYPTION_KEY_VERSION inválida: use apenas letras, números, ponto, hífen ou sublinhado');
  }
  return version;
}

function getKeyRing(): KeyRing {
  const activeRaw = process.env.ENCRYPTION_KEY;
  if (!activeRaw) throw new Error('ENCRYPTION_KEY não configurada');

  const activeVersion = parseKeyVersion(process.env.ENCRYPTION_KEY_VERSION);
  const activeKey = parseKey(activeRaw, 'ENCRYPTION_KEY');
  const keys = new Map<string, Buffer>([[activeVersion, activeKey]]);
  const keyRingRaw = process.env.ENCRYPTION_KEYRING?.trim();

  if (keyRingRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(keyRingRaw);
    } catch {
      throw new Error('ENCRYPTION_KEYRING inválido: esperado um objeto JSON com versões e chaves');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('ENCRYPTION_KEYRING inválido: esperado um objeto JSON com versões e chaves');
    }

    for (const [version, rawKey] of Object.entries(parsed)) {
      if (!KEY_VERSION_PATTERN.test(version) || typeof rawKey !== 'string') {
        throw new Error('ENCRYPTION_KEYRING contém uma versão ou chave inválida');
      }

      const key = parseKey(rawKey, `ENCRYPTION_KEYRING[${version}]`);
      const existing = keys.get(version);
      if (existing && !existing.equals(key)) {
        throw new Error(`ENCRYPTION_KEYRING conflita com ENCRYPTION_KEY na versão ${version}`);
      }
      keys.set(version, key);
    }
  }

  return { activeVersion, keys };
}

function getAad(version: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${version}`, 'utf8');
}

function decryptVersioned(encoded: string): DecryptedSecret | null {
  const parts = encoded.split(':');
  if (parts.length !== 5 || parts[0] !== VERSIONED_PREFIX.slice(0, -1)) return null;

  const [, keyVersion, ivHex, authTagHex, ciphertextHex] = parts;
  if (!keyVersion || !KEY_VERSION_PATTERN.test(keyVersion) || !ivHex || !authTagHex || !ciphertextHex) {
    return null;
  }

  const { keys, activeVersion } = getKeyRing();
  const key = keys.get(keyVersion);
  if (!key) return null;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(getAad(keyVersion));
    decipher.setAuthTag(authTag);
    const value = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return { value, keyVersion, needsRotation: keyVersion !== activeVersion };
  } catch {
    return null;
  }
}

function decryptLegacy(encoded: string): DecryptedSecret | null {
  // Compatibilidade: payloads legacy (packages/lib) para secrets antigos em Conta.
  if (encoded.startsWith(LEGACY_PREFIX_V1)) {
    try {
      return {
        value: Buffer.from(encoded.slice(LEGACY_PREFIX_V1.length), 'base64').toString('utf8'),
        keyVersion: null,
        needsRotation: true,
      };
    } catch {
      return null;
    }
  }

  if (encoded.startsWith(LEGACY_PREFIX_V2)) {
    const { keys } = getKeyRing();

    const buf = Buffer.from(encoded.slice(LEGACY_PREFIX_V2.length), 'base64');
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    if (ciphertext.length === 0) return null;

    for (const [keyVersion, key] of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const value = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return { value, keyVersion, needsRotation: true };
      } catch {
        // Tenta a próxima versão somente para payloads legados sem metadado de chave.
      }
    }
    return null;
  }

  try {
    const parts = encoded.split(':');
    if (parts.length !== 4) return null;

    const [ivHex, , authTagHex, encryptedHex] = parts;
    const { keys } = getKeyRing();
    if (!ivHex || !authTagHex || !encryptedHex) return null;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    if (iv.length === 0 || authTag.length !== AUTH_TAG_LENGTH) return null;

    for (const [keyVersion, key] of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let value = decipher.update(encryptedHex, 'hex', 'utf8');
        value += decipher.final('utf8');
        return { value, keyVersion, needsRotation: true };
      } catch {
        // Tenta a próxima versão somente para payloads legados sem metadado de chave.
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function encryptSecret(plaintext: string): string {
  const { activeVersion, keys } = getKeyRing();
  const key = keys.get(activeVersion);
  if (!key) throw new Error(`Chave ativa não encontrada para a versão ${activeVersion}`);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(getAad(activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSIONED_PREFIX.slice(0, -1),
    activeVersion,
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptSecretWithMetadata(encoded: string | null | undefined): DecryptedSecret | null {
  if (!encoded) return null;
  return decryptVersioned(encoded) ?? decryptLegacy(encoded);
}

export function decryptSecret(encoded: string | null | undefined): string | null {
  return decryptSecretWithMetadata(encoded)?.value ?? null;
}

export function validateEncryptionConfiguration(): { activeVersion: string; keyVersions: string[] } {
  const { activeVersion, keys } = getKeyRing();
  return { activeVersion, keyVersions: [...keys.keys()] };
}
