import { timingSafeEqual } from 'node:crypto';

import { globalAdminEnvSchema } from './schemas';

function compareSensitiveText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/** Mesmo comprimento em UTF-8 após normalização; comparação em tempo constante. */
function compareUsernameInsensitive(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left.trim().toLowerCase(), 'utf8');
  const rightBuffer = Buffer.from(right.trim().toLowerCase(), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getGlobalAdminAuthConfig() {
  return globalAdminEnvSchema.parse({
    username: process.env.GLOBAL_ADMIN_USERNAME,
    password: process.env.GLOBAL_ADMIN_PASSWORD,
    sessionSecret: process.env.GLOBAL_ADMIN_SESSION_SECRET ?? process.env.NEXTAUTH_SECRET,
  });
}

export function validateGlobalAdminCredentials(input: { username: string; password: string }): boolean {
  const config = getGlobalAdminAuthConfig();
  return (
    compareUsernameInsensitive(input.username, config.username) &&
    compareSensitiveText(input.password, config.password)
  );
}
