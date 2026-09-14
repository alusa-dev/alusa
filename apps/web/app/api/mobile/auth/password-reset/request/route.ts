import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sendPasswordResetForEmail } from '@/lib/auth-email-flow';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
});

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  const subject = await rateLimitSubject(`${ip}:${parsed.success ? parsed.data.email : 'invalid'}`);
  const limit = await authRateLimitAsync(`mobile-password-reset:${subject}`, 5, 15 * 60 * 1000);

  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' } },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Informe um e-mail válido.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    await sendPasswordResetForEmail(parsed.data.email, {
      ip,
      userAgent: request.headers.get('user-agent'),
    });
  } catch (error) {
    console.error('[mobile-auth][password-reset]', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Não foi possível enviar as instruções agora.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ ok: true }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
