import { NextRequest, NextResponse } from 'next/server';
import { getUnreadNotificationCount } from '@alusa/lib/services/notifications.service';
import { isTransientDatabaseError } from '@alusa/lib/database-retry';
import {
  buildNotificationUnreadCountCacheKey,
  getNotificationCache,
  setNotificationCache,
} from '@/lib/notifications/notification-cache';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const inFlightCounts = new Map<string, Promise<number>>();

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function isDatabasePoolTimeout(error: unknown): boolean {
  return isTransientDatabaseError(error);
}

export async function GET(req: NextRequest) {
  const timer = createPerfTimer('api/notifications/unread-count');
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    const user = { id: auth.userId, contaId: auth.contaId, role: auth.role };
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para acessar notificações.' });
    }

    const cacheKey = buildNotificationUnreadCountCacheKey(user.contaId, user.id);
    const cached = await getNotificationCache<{ count: number }>(cacheKey);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /notifications/unread-count (cache hit)', { cacheState: cached.state });
      return json(200, cached.body);
    }

    const requestKey = `${user.contaId}:${user.id}`;
    let countPromise = inFlightCounts.get(requestKey);
    if (!countPromise) {
      countPromise = withPerfTimer(
        'notifications',
        'getUnreadNotificationCount',
        () => getUnreadNotificationCount({ contaId: user.contaId!, userId: user.id! }),
        { contaId: user.contaId },
      );
      inFlightCounts.set(requestKey, countPromise);
      void countPromise
        .then(
          () => inFlightCounts.delete(requestKey),
          () => inFlightCounts.delete(requestKey),
        );
    }

    const body = { count: await countPromise };
    await setNotificationCache(cacheKey, body, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 240,
    }).catch((cacheError) => {
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'api.notifications.cache_write.failed',
        route: '/api/notifications/unread-count',
        method: 'GET',
        requestId: getRequestId(req),
        error: cacheError,
      });
    });
    timer.end('GET /notifications/unread-count (cache miss)');

    return json(200, body);
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: isDatabasePoolTimeout(error)
        ? 'api.notifications.database_pool_timeout'
        : 'api.notifications.request.failed',
      route: '/api/notifications/unread-count',
      method: 'GET',
      requestId: getRequestId(req),
      error,
    });
    if (isDatabasePoolTimeout(error)) {
      return NextResponse.json(
        { error: 'BANCO_TEMPORARIAMENTE_INDISPONIVEL', message: 'O contador será atualizado novamente em instantes.' },
        {
          status: 503,
          headers: {
            'cache-control': 'no-store',
            'retry-after': '2',
          },
        },
      );
    }

    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível carregar o contador de notificações.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
