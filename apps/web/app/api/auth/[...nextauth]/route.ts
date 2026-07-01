import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT_EXEMPT_GET_ACTIONS = new Set(['session', 'csrf', 'providers']);

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
    const shouldRateLimit =
      req.method !== 'GET' || !action || !RATE_LIMIT_EXEMPT_GET_ACTIONS.has(action);

    // 60 reqs / 15min por IP para endpoints de auth
    if (shouldRateLimit) {
      const ip = ipFromRequest(req as unknown as Request);
      const rl = rateLimit(`nextauth:${ip}`, 60, 15 * 60 * 1000);

      if (!rl.ok) {
        return NextResponse.json(
          { error: 'Muitas tentativas. Tente novamente mais tarde.' },
          { status: 429 },
        );
      }
    }

    // Chama o handler original do NextAuth
    const handler = await resolveHandler();
    return await handler(req, ctx);
  } catch (err) {
    // Evita "Unexpected end of JSON input" no cliente
    console.error('[nextauth][route-error]', err);
    return NextResponse.json({ error: 'Auth handler error' }, { status: 500 });
  }
}

export { withRateLimit as GET, withRateLimit as POST };
