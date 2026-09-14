import { NextResponse } from 'next/server';

import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import {
  loginMobile,
  mobileAuthErrorStatus,
  mobileLoginSchema,
  MobileAuthError,
} from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const body = await request.json().catch(() => null);
  const parsed = mobileLoginSchema.safeParse(body);
  const email = parsed.success ? parsed.data.email : 'invalid';
  const subject = await rateLimitSubject(`${ip}:${email}`);
  const limit = await authRateLimitAsync(`mobile-login:${subject}`, 10, 15 * 60 * 1000);

  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' } },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    const session = await loginMobile(body, {
      ip,
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(session, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = mobileAuthErrorStatus(error);
    const message = error instanceof MobileAuthError && error.code === 'INVALID_INPUT'
      ? 'Informe um e-mail e uma senha válidos.'
      : 'E-mail ou senha inválidos.';

    if (status >= 500) {
      console.error('[mobile-auth][login]', { error: error instanceof Error ? error.message : String(error) });
    }

    return NextResponse.json(
      { error: { code: status === 400 ? 'VALIDATION_ERROR' : 'UNAUTHORIZED', message } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
