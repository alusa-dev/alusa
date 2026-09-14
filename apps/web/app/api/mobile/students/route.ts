import { NextResponse } from 'next/server';

import { listMobileStudents, MobileStudentUnauthorizedError } from '@/features/students/server/mobile-students.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-students:list:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = await listMobileStudents({ userId: actor.userId, contaId: actor.contaId });
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return unauthorized();
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar os alunos.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
