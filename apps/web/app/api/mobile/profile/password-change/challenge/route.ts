import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authRateLimitAsync, ipFromRequest } from '@/lib/rate-limit';
import { requestPasswordChangeOtp } from '@/lib/password-change-otp';
import {
  getMobilePasswordChangeActor,
  otpErrorResponse,
  unauthorized,
} from '@/src/server/mobile/mobile-password-change-http.service';

export const runtime = 'nodejs';

const bodySchema = z.object({
  channel: z.enum(['email', 'whatsapp']),
});

export async function POST(request: Request) {
  const actor = await getMobilePasswordChangeActor(request);
  if (!actor) return unauthorized();

  const ip = ipFromRequest(request);
  const rate = await authRateLimitAsync(
    `mobile-password-change-otp:request:${actor.userId}:${ip}`,
    5,
    15 * 60_000,
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Você tentou muitas vezes, aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Canal de envio inválido.' } },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = await requestPasswordChangeOtp({
      userId: actor.userId,
      channel: parsed.data.channel,
      requestedByIp: ip,
      requestedByUserAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json(
      {
        challengeId: result.challengeId,
        channel: result.channel,
        destination: result.destination,
        expiresAt: result.expiresAt,
        resendAvailableAt: result.resendAvailableAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return otpErrorResponse(error, 'Não foi possível enviar o código.', 'challenge');
  }
}
