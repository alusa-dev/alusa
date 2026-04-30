import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY não configurada');
    }
    return key;
}
export function encryptSecret(plaintext) {
    const key = Buffer.from(getEncryptionKey(), 'hex');
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
    try {
        const parts = encoded.split(':');
        if (parts.length !== 4)
            return null;
        const [ivHex, , authTagHex, encryptedHex] = parts;
        const key = Buffer.from(getEncryptionKey(), 'hex');
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
