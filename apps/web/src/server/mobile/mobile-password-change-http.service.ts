import { NextResponse } from 'next/server';

import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { PasswordChangeOtpError } from '@/lib/password-change-otp';
import { prisma } from '@/lib/prisma';

export type MobilePasswordChangeActor = {
  userId: string;
  contaId: string;
};

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

export async function getMobilePasswordChangeActor(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;

  const actor = await verifyMobileAccessToken(token);
  if (!actor) return null;

  const membership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true },
  });

  return membership ? { userId: actor.userId, contaId: actor.contaId } satisfies MobilePasswordChangeActor : null;
}

export function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function otpErrorResponse(error: unknown, fallback: string, scope: string) {
  if (error instanceof PasswordChangeOtpError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  console.error(`[mobile-auth][password-change][${scope}]`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: fallback } },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
