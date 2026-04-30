import { decryptSecret } from '../../packages/database/src/security/encryption.js';

const encrypted = process.argv[2];
const key = process.env.ENCRYPTION_KEY;

if (!encrypted || !key) {
  console.error('Uso: ENCRYPTION_KEY=... node decrypt-key.mjs <apiKeyEncrypted>');
  process.exit(1);
}

console.log(decryptSecret(encrypted, key));
