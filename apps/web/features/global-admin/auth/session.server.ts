import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
};

function buildSessionFromPayload(payload: { sub: string; iat?: number; exp?: number }): GlobalAdminSession {
  return {
    username: payload.sub,
    issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
  };
}

export async function getGlobalAdminSession(): Promise<GlobalAdminSession | null> {
  const token = cookies().get(getGlobalAdminSessionCookieOptions().name)?.value ?? null;
  const payload = await verifyGlobalAdminSessionToken(token);
  if (!payload) return null;
  return buildSessionFromPayload(payload);
}

export async function requireGlobalAdminSessionForPage(callbackUrl: string) {
  const session = await getGlobalAdminSession();
  if (!session) {
    const loginUrl = new URL('/developer/login', 'http://localhost');
    loginUrl.searchParams.set('callbackUrl', callbackUrl);
    redirect(loginUrl.pathname + loginUrl.search);
  }
  return session;
}

export async function requireGlobalAdminSessionForApi() {
  const session = await getGlobalAdminSession();

  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Não autorizado' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const, session };
}

export async function attachGlobalAdminSession(response: NextResponse, username: string) {
  const token = await createGlobalAdminSessionToken(username);
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
