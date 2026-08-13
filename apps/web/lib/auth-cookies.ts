const baseAuthCookieNames = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.callback-url',
  '__Secure-next-auth.callback-url',
  'next-auth.csrf-token',
  '__Host-next-auth.csrf-token',
] as const;

const authCookieNamePattern = /^(?:__Secure-)?next-auth\.(?:session-token(?:\.\d+)?|callback-url|csrf-token|pkce\.code_verifier|state|nonce)$/;

function cookieNamesFromRequest(cookieHeader?: string | null): string[] {
  if (!cookieHeader) return [];

  return cookieHeader
    .split(';')
    .map((part) => part.trim().split('=', 1)[0] ?? '')
    .filter((name) => authCookieNamePattern.test(name) || name === '__Host-next-auth.csrf-token');
}

function expiredCookie(name: string): string {
  const secure = name.startsWith('__Secure-') || name.startsWith('__Host-') ? '; Secure' : '';
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * Expira todos os cookies do NextAuth presentes na requisição, inclusive JWTs
 * fragmentados. Mantém os nomes de ambas as configurações HTTP/HTTPS para
 * suportar transições de ambiente sem deixar sessão residual.
 */
export function clearAuthCookies(response: Response, cookieHeader?: string | null): Response {
  const names = new Set([...baseAuthCookieNames, ...cookieNamesFromRequest(cookieHeader)]);
  for (const name of names) {
    if (response instanceof NextResponse) {
      response.cookies.set({
        name,
        value: '',
        path: '/',
        maxAge: 0,
        httpOnly: true,
        sameSite: 'lax',
        secure: name.startsWith('__Secure-') || name.startsWith('__Host-'),
      });
    } else {
      response.headers.append('set-cookie', expiredCookie(name));
    }
  }
  return response;
}
import { NextResponse } from 'next/server';
