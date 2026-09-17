import { getUnreadNotificationCount } from '@alusa/lib/services/notifications.service';
import { NextResponse } from 'next/server';

import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function unauthorized() {
  return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return unauthorized();
  if (!allowedRoles.has(actor.role.toUpperCase())) {
    return response({ error: { code: 'FORBIDDEN', message: 'Usuário sem permissão para acessar notificações.' } }, 403);
  }

  const limiter = rateLimit(`mobile-notifications:unread:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  try {
    const count = await getUnreadNotificationCount({ contaId: actor.contaId, userId: actor.userId });
    return response({ count });
  } catch (error) {
    console.error('[api/mobile/notifications][unread-count]', error instanceof Error ? error.message : String(error));
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível consultar as notificações.' } }, 500);
  }
}
