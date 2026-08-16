import {
  decryptSecret,
  decryptSecretWithMetadata,
  encryptSecret,
  type DecryptedSecret,
} from '@alusa/database';

export interface CredentialVault {
  encrypt(secret: string): string;
  decrypt(encrypted: string): string;
  decryptWithMetadata(encrypted: string): DecryptedSecret;
  reencryptIfNeeded(encrypted: string): string;
  verifyRoundTrip(encrypted: string, expected: string): void;
}

export const credentialVault: CredentialVault = {
  encrypt(secret) {
    return encryptSecret(secret);
  },
  decrypt(encrypted) {
    const value = decryptSecret(encrypted);
    if (!value) {
      throw new Error('Falha ao descriptografar credencial');
    }
    return value;
  },
  decryptWithMetadata(encrypted) {
    const value = decryptSecretWithMetadata(encrypted);
    if (!value) {
      throw new Error('Falha ao descriptografar credencial');
    }
    return value;
  },
  reencryptIfNeeded(encrypted) {
    const value = credentialVault.decryptWithMetadata(encrypted);
    return value.needsRotation ? credentialVault.encrypt(value.value) : encrypted;
  },
  verifyRoundTrip(encrypted, expected) {
    const decrypted = credentialVault.decrypt(encrypted);
    if (decrypted !== expected) {
      throw new Error('Falha na validação de round-trip da credencial');
    }
  },
};
