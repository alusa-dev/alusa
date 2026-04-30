import crypto from 'crypto';

const raw = process.env.ENCRYPTION_KEY;
if (!raw) {
  console.error('ENCRYPTION_KEY missing');
  process.exit(2);
}
const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');

let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => s += d);
process.stdin.on('end', () => {
  const encoded = s.trim();
  if (!encoded) {
    console.error('No encoded input');
    process.exit(3);
  }
  const parts = encoded.split(':');
  if (parts.length < 4) {
    console.error('Unexpected format: expected iv:salt:authTag:encrypted');
    process.exit(4);
  }
  const [ivHex, , authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    console.log(decrypted);
  } catch (e) {
    console.error('Decryption failed:', e.message);
    process.exit(5);
  }
});
