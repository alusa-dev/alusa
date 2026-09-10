import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { authRateLimitAsync, ipFromRequest } from '@/lib/rate-limit';
import { resolveUserId } from '../../helpers';
import {
  PasswordChangeOtpError,
  verifyPasswordChangeOtp,
} from '@/lib/password-change-otp';

const bodySchema = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/, 'Informe o código de 6 dígitos.'),
});

function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const configuredOrigin = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (configuredOrigin && origin === configuredOrigin) return true;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(req.url).protocol.replace(':', '');
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host') || new URL(req.url).host;
  return origin === `${forwardedProto}://${host}`;
}

function errorResponse(error: unknown) {
  if (error instanceof PasswordChangeOtpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('[auth][password-change-otp][verify]', error);
  return NextResponse.json({ error: 'Não foi possível validar o código.' }, { status: 503 });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const userId = await resolveUserId(session?.user?.id);
  if (!userId) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const ip = ipFromRequest(req);
  const rate = await authRateLimitAsync(`account:password-change-otp:verify:${userId}:${ip}`, 10, 15 * 60_000);
  if (!rate.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Solicite um novo código mais tarde.' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Código inválido.' }, { status: 422 });
  }

  try {
    const result = await verifyPasswordChangeOtp({ userId, ...parsed.data });
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
