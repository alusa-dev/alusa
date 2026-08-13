import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { resolveSessionAccess } from '@/lib/auth-service';

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  const userId = typeof token?.id === 'string' ? token.id : null;
  const contaId = typeof token?.contaId === 'string' ? token.contaId : null;
  const sessionVersion = typeof token?.sessionVersion === 'number' ? token.sessionVersion : null;

  if (!userId) {
    return json(401, { ok: false, reason: 'UNAUTHENTICATED' });
  }

  try {
    const access = await resolveSessionAccess({ userId, contaId, sessionVersion });
    if (!access.ok) {
      return json(403, { ok: false, reason: access.reason });
    }

    return json(200, { ok: true });
  } catch {
    return json(503, { ok: false, reason: 'ACCESS_CHECK_UNAVAILABLE' });
  }
}
