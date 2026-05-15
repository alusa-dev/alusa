import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  createGlobalAdminSessionToken,
  getGlobalAdminSessionCookieOptions,
  verifyGlobalAdminSessionToken,
} from './session';

export type GlobalAdminSession = {
  username: string;
  issuedAt: string;
  expiresAt: string;
  supportUserId?: string | null;
  role:
    | 'SUPPORT_VIEWER'
    | 'SUPPORT_AGENT'
    | 'SUPPORT_FINANCE'
    | 'SUPPORT_DEVELOPER'
    | 'SUPPORT_ADMIN'
    | 'BREAK_GLASS';
};

/** Sessão fixa para a central `/developer` sem login por palavra-passe (acesso ao URL = acesso à consola). */
const SUPPORT_CONSOLE_OPEN_SESSION: GlobalAdminSession = {
  username: 'central',
  issuedAt: new Date(0).toISOString(),
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString(),
  supportUserId: null,
  role: 'SUPPORT_ADMIN',
};

function buildSessionFromPayload(payload: {
  sub: string;
  supportUserId?: string;
  role?: GlobalAdminSession['role'];
  iat?: number;
  exp?: number;
}): GlobalAdminSession {
  return {
    username: payload.sub,
    issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    supportUserId: payload.supportUserId ?? null,
    role: payload.role ?? 'SUPPORT_ADMIN',
  };
}

export async function getGlobalAdminSession(): Promise<GlobalAdminSession | null> {
  const token = cookies().get(getGlobalAdminSessionCookieOptions().name)?.value ?? null;
  const payload = await verifyGlobalAdminSessionToken(token);
  if (!payload) return null;
  return buildSessionFromPayload(payload);
}

export async function requireGlobalAdminSessionForPage(_callbackUrl: string) {
  return SUPPORT_CONSOLE_OPEN_SESSION;
}

export async function requireGlobalAdminSessionForApi() {
  return { ok: true as const, session: SUPPORT_CONSOLE_OPEN_SESSION };
}

export async function attachGlobalAdminSession(
  response: NextResponse,
  username: string,
  input: { supportUserId?: string | null; role?: GlobalAdminSession['role'] | null } = {},
) {
  const token = await createGlobalAdminSessionToken(username, input);
  const { name, options } = getGlobalAdminSessionCookieOptions();
  response.cookies.set(name, token, options);
}

export function clearGlobalAdminSession(response: NextResponse) {
  const { name } = getGlobalAdminSessionCookieOptions();
  response.cookies.set(name, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
