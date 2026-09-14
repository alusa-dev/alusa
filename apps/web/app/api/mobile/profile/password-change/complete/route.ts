import { NextResponse } from 'next/server';
import { z } from 'zod';

import { completePasswordChange } from '@/lib/password-change-otp';
import { passwordPolicyMessage, passwordPolicyRegex } from '@/lib/password-policy';
import { authRateLimitAsync, ipFromRequest } from '@/lib/rate-limit';
import {
  getMobilePasswordChangeActor,
  otpErrorResponse,
  unauthorized,
} from '../_shared';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    challengeId: z.string().min(1).max(128),
    verificationToken: z.string().min(20).max(256),
    newPassword: z.string().regex(passwordPolicyRegex, passwordPolicyMessage),
    confirmPassword: z.string().min(1, 'Confirme a nova senha.'),
    revokeAllSessions: z.boolean().default(false),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não coincidem.',
  });

export async function POST(request: Request) {
  const actor = await getMobilePasswordChangeActor(request);
  if (!actor) return unauthorized();

  const ip = ipFromRequest(request);
  const rate = await authRateLimitAsync(
    `mobile-password-change-otp:complete:${actor.userId}:${ip}`,
    5,
    15 * 60_000,
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message || 'Dados inválidos.' } },
      { status: 422, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = await completePasswordChange({
      userId: actor.userId,
      ...parsed.data,
      requestedByIp: ip,
      requestedByUserAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return otpErrorResponse(error, 'Não foi possível atualizar a senha.', 'complete');
  }
}
