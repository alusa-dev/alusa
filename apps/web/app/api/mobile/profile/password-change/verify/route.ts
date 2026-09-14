import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimitAsync, ipFromRequest } from '@/lib/rate-limit';
import { verifyPasswordChangeOtp } from '@/lib/password-change-otp';
import {
  getMobilePasswordChangeActor,
  otpErrorResponse,
  unauthorized,
} from '../_shared';

export const runtime = 'nodejs';

const bodySchema = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/, 'Informe o código de 6 dígitos.'),
});

export async function POST(request: Request) {
  const actor = await getMobilePasswordChangeActor(request);
  if (!actor) return unauthorized();

  const ip = ipFromRequest(request);
  const rate = await authRateLimitAsync(
    `mobile-password-change-otp:verify:${actor.userId}:${ip}`,
    10,
    15 * 60_000,
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Solicite um novo código mais tarde.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Código inválido.' } },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = await verifyPasswordChangeOtp({ userId: actor.userId, ...parsed.data });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return otpErrorResponse(error, 'Não foi possível validar o código.', 'verify');
  }
}
