import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const LEGACY_PREFIX_V1 = 'v1:';
const LEGACY_PREFIX_V2 = 'v2:';
function getEncryptionKeyBuffer() {
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
export function encryptSecret(plaintext) {
    const key = getEncryptionKeyBuffer();
    const iv = randomBytes(IV_LENGTH);
    const salt = randomBytes(SALT_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${salt.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
export function decryptSecret(encoded) {
    if (!encoded)
        return null;
    if (encoded.startsWith(LEGACY_PREFIX_V1)) {
        try {
            return Buffer.from(encoded.slice(LEGACY_PREFIX_V1.length), 'base64').toString('utf8');
        }
        catch {
            return null;
        }
    }
    if (encoded.startsWith(LEGACY_PREFIX_V2)) {
        const key = getEncryptionKeyBuffer();
        const b64 = encoded.slice(LEGACY_PREFIX_V2.length);
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 12 + 16)
            return null;
        const iv = buf.subarray(0, 12);
        const authTag = buf.subarray(12, 28);
        const ciphertext = buf.subarray(28);
        try {
            const decipher = createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return decrypted.toString('utf8');
        }
        catch {
            return null;
        }
    }
    try {
        const parts = encoded.split(':');
        if (parts.length !== 4)
            return null;
        const [ivHex, , authTagHex, encryptedHex] = parts;
        const key = getEncryptionKeyBuffer();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch {
        return null;
    }
}
