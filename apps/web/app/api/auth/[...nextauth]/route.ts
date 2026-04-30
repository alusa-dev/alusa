import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    // 60 reqs / 15min por IP para endpoints de auth
    const ip = ipFromRequest(req as unknown as Request);
    const rl = rateLimit(`nextauth:${ip}`, 60, 15 * 60 * 1000);

    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Tente novamente mais tarde.' },
        { status: 429 },
      );
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
