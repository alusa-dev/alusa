import { decryptSecret, encryptSecret } from '@alusa/database';

export interface CredentialVault {
  encrypt(secret: string): string;
  decrypt(encrypted: string): string;
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
};
