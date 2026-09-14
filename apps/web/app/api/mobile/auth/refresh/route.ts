import { NextResponse } from 'next/server';

import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import {
  mobileAuthErrorStatus,
  refreshMobileSession,
  MobileAuthError,
} from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const subject = await rateLimitSubject(`refresh:${ipFromRequest(request)}`);
  const limit = await authRateLimitAsync(`mobile-refresh:${subject}`, 60, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const body = await request.json().catch(() => null);
  try {
    const session = await refreshMobileSession(body, {
      ip: ipFromRequest(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(session, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = mobileAuthErrorStatus(error);
    const message = error instanceof MobileAuthError && error.code === 'INVALID_INPUT'
      ? 'Refresh token inválido.'
      : 'Sessão expirada. Faça login novamente.';
    return NextResponse.json(
      { error: { code: status === 400 ? 'VALIDATION_ERROR' : 'UNAUTHORIZED', message } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
