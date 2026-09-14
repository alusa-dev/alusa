import { NextResponse } from 'next/server';

import {
  listMobileAgendaResources,
  MobileAgendaForbiddenError,
  MobileAgendaUnauthorizedError,
} from '@/features/aulas/server/mobile-agenda.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const value = bearerToken(request);
  const actor = value ? await verifyMobileAccessToken(value) : null;
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);

  const limiter = rateLimit(`mobile-agenda:resources:${actor.userId}:${ipFromRequest(request)}`, 20, 10 * 60 * 1000);
  if (!limiter.ok) return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);

  try {
    const resources = await listMobileAgendaResources({ userId: actor.userId, contaId: actor.contaId });
    return response({ resources });
  } catch (error) {
    if (error instanceof MobileAgendaUnauthorizedError) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
    if (error instanceof MobileAgendaForbiddenError) return response({ error: { code: 'FORBIDDEN', message: error.message } }, 403);
    console.error('[mobile-agenda][resources]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar os filtros da agenda.' } }, 500);
  }
}
