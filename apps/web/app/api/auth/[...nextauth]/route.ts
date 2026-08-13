import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { clearAuthCookies } from '@/lib/auth-cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getNextAuthAction(req: NextRequest): string | null {
  const prefix = '/api/auth/';
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split('/')[0] || null;
}

async function resolveHandler() {
  const { authOptions } = await import('@/lib/auth-options');
  return NextAuth(authOptions);
}

// Wrapper de rate limiting para o NextAuth
async function withRateLimit(
  req: NextRequest,
  ctx?: { params?: Record<string, string | string[]> },
): Promise<Response> {
  try {
    const action = getNextAuthAction(req);
    // Apenas a confirmação de credenciais é sujeita a limite. Logout, CSRF e
    // leitura de sessão nunca podem ser bloqueados, pois precisam recuperar o usuário.
    if (action === 'callback' && req.nextUrl.pathname.endsWith('/credentials')) {
      const ip = ipFromRequest(req as unknown as Request);
      const form = await req.clone().formData().catch(() => null);
      const email = form?.get('email');
      const callbackIpLimit = await authRateLimitAsync(`nextauth-credentials:ip:${ip}`, 10, 15 * 60 * 1000);
      const emailLimit = typeof email === 'string'
        ? await authRateLimitAsync(`nextauth-credentials:email:${await rateLimitSubject(email)}`, 5, 15 * 60 * 1000)
        : callbackIpLimit;

      if (!callbackIpLimit.ok || !emailLimit.ok) {
        return NextResponse.json(
          { error: 'Muitas tentativas. Tente novamente mais tarde.' },
          { status: 429, headers: { 'Retry-After': '900', 'Cache-Control': 'no-store' } },
        );
      }
    }

    // Chama o handler original do NextAuth
    const handler = await resolveHandler();
    const response = await handler(req, ctx);
    return action === 'signout' ? clearAuthCookies(response, req.headers.get('cookie')) : response;
  } catch (err) {
    // Evita "Unexpected end of JSON input" no cliente
    console.error('[nextauth][route-error]', err);
    return NextResponse.json({ error: 'Auth handler error' }, { status: 500 });
  }
}

export { withRateLimit as GET, withRateLimit as POST };
