import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getUnreadNotificationCount } from '@alusa/lib';
import { authOptions } from '@/lib/auth-options';
import { privateJson } from '@/lib/private-cache';
import {
  buildNotificationUnreadCountCacheKey,
  getNotificationCache,
  setNotificationCache,
} from '@/lib/notifications/notification-cache';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET(_req: NextRequest) {
  const timer = createPerfTimer('api/notifications/unread-count');
  try {
    const user = await resolveAuth();
    if (!user?.id || !user.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para acessar notificações.' });
    }

    const cacheKey = buildNotificationUnreadCountCacheKey(user.contaId, user.id);
    const cached = await getNotificationCache<{ count: number }>(cacheKey);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /notifications/unread-count (cache hit)', { cacheState: cached.state });
      return privateJson(cached.body, {
        maxAgeSeconds: 60,
        staleWhileRevalidateSeconds: 240,
        cacheState: cached.state,
      });
    }

    const body = {
      count: await withPerfTimer(
        'notifications',
        'getUnreadNotificationCount',
        () => getUnreadNotificationCount({ contaId: user.contaId!, userId: user.id! }),
        { contaId: user.contaId },
      ),
    };
    await setNotificationCache(cacheKey, body, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 240,
    });
    timer.end('GET /notifications/unread-count (cache miss)');

    return privateJson(body, {
      maxAgeSeconds: 60,
      staleWhileRevalidateSeconds: 240,
      cacheState: 'MISS',
    });
  } catch (error) {
    console.error('[Notifications][UnreadCount][GET]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível carregar o contador de notificações.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
