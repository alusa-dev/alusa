import { SignJWT, jwtVerify } from 'jose';

import { globalAdminSessionPayloadSchema } from './schemas';

export const GLOBAL_ADMIN_SESSION_COOKIE = 'alusa.global_admin.session';
export const GLOBAL_ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 6;

async function getSessionSecretKey() {
  const secret =
    process.env.GLOBAL_ADMIN_SESSION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    throw new Error('GLOBAL_ADMIN_SESSION_SECRET ausente');
  }

  return new TextEncoder().encode(secret);
}

export async function createGlobalAdminSessionToken(username: string) {
  return new SignJWT({ scope: 'GLOBAL_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${GLOBAL_ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(await getSessionSecretKey());
}

export async function verifyGlobalAdminSessionToken(token?: string | null) {
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, await getSessionSecretKey());
    return globalAdminSessionPayloadSchema.parse(verified.payload);
  } catch {
    return null;
  }
}

export function getGlobalAdminSessionCookieOptions() {
  return {
    name: GLOBAL_ADMIN_SESSION_COOKIE,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GLOBAL_ADMIN_SESSION_TTL_SECONDS,
    },
  };
}
