import { encryptSecret, decryptSecret } from "../../packages/database/src/security/encryption.js";

const plain = process.argv[2];
const key = process.env.ENCRYPTION_KEY;

if (!plain || !key) {
  console.error('Uso: ENCRYPTION_KEY=... node encrypt-decrypt-key.mjs <valor>');
  process.exit(1);
}

const encrypted = encryptSecret(plain);
console.log('Criptografado:', encrypted);
const decrypted = decryptSecret(encrypted);
console.log('Descriptografado:', decrypted);
