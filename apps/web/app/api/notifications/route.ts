import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import { listNotifications, markAllNotificationsAsRead, type NotificationFeedView } from '@alusa/lib';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  view: z.enum(['active', 'archived', 'all']).optional(),
});
const bulkActionSchema = z.object({
  action: z.literal('markAllRead'),
});
const notificationsCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 15,
  staleWhileRevalidateSeconds: 45,
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function serialize(result: Awaited<ReturnType<typeof listNotifications>>) {
  return {
    items: result.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      triggeredAt: item.triggeredAt.toISOString(),
      readAt: item.readAt?.toISOString() ?? null,
      archivedAt: item.archivedAt?.toISOString() ?? null,
    })),
    unreadCount: result.unreadCount,
    totalCount: result.totalCount,
  };
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET(req: NextRequest) {
  const timer = createPerfTimer('api/notifications');
  try {
    const user = await resolveAuth();
    if (!user?.id || !user.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para acessar notificações.' });
    }

    const parsed = listQuerySchema.safeParse({
      limit: req.nextUrl.searchParams.get('limit') ?? undefined,
      page: req.nextUrl.searchParams.get('page') ?? undefined,
      view: req.nextUrl.searchParams.get('view') ?? undefined,
    });

    if (!parsed.success) {
      return json(422, {
        error: 'PARAMETROS_INVALIDOS',
        message: 'Parâmetros de consulta inválidos.',
        details: parsed.error.flatten(),
      });
    }

    const cacheKey = [
      user.contaId,
      user.id,
      parsed.data.view ?? 'active',
      parsed.data.limit ?? 'default',
      parsed.data.page ?? 'default',
    ].join(':');
    const cached = notificationsCache.get(cacheKey);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /notifications (cache hit)', { cacheState: cached.state });
      return privateJson(cached.body, {
        maxAgeSeconds: 15,
        staleWhileRevalidateSeconds: 45,
        cacheState: cached.state,
      });
    }

    const result = await withPerfTimer(
      'notifications',
      'listNotifications',
      () => listNotifications({
        contaId: user.contaId!,
        userId: user.id!,
        limit: parsed.data.limit,
        page: parsed.data.page,
        view: parsed.data.view as NotificationFeedView | undefined,
      }),
      { contaId: user.contaId }
    );

    const body = serialize(result);
    notificationsCache.set(cacheKey, body);
    timer.end('GET /notifications (cache miss)');
    return privateJson(body, {
      maxAgeSeconds: 15,
      staleWhileRevalidateSeconds: 45,
      cacheState: 'MISS',
    });
  } catch (error) {
    console.error('[Notifications][GET]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível carregar as notificações.' });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para atualizar notificações.' });
    }

    const body = await req.json().catch(() => null);
    const parsed = bulkActionSchema.safeParse(body);
    if (!parsed.success) {
      return json(422, {
        error: 'PAYLOAD_INVALIDO',
        message: 'Payload inválido para ação em lote.',
        details: parsed.error.flatten(),
      });
    }

    const updatedCount = await withPerfTimer(
      'notifications',
      'markAllNotificationsAsRead',
      () => markAllNotificationsAsRead({
        contaId: user.contaId!,
        userId: user.id!,
      }),
      { contaId: user.contaId }
    );

    notificationsCache.clear();
    return json(200, { success: true, updatedCount });
  } catch (error) {
    console.error('[Notifications][PATCH]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível atualizar as notificações.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
