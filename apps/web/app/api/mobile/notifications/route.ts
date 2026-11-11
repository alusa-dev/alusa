import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import {
  listNotifications,
  markAllNotificationsAsRead,
  type NotificationFeedView,
} from '@alusa/lib/services/notifications.service';
import { NextResponse } from 'next/server';
import { notificationBulkActionResponseSchema, notificationBulkActionSchema, notificationListQuerySchema, serializeNotificationFeed } from '@alusa/lib/notifications/inbox-contract';

import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const listQuerySchema = notificationListQuerySchema(50, true);
const bulkActionSchema = notificationBulkActionSchema;

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

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

function hasInboxAccess(actor: Awaited<ReturnType<typeof authenticate>>) {
  return Boolean(actor && allowedRoles.has(actor.role.toUpperCase()));
}

function unauthorized() {
  return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
}

function forbidden() {
  return response({ error: { code: 'FORBIDDEN', message: 'Usuário sem permissão para acessar notificações.' } }, 403);
}

export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();
  if (!hasInboxAccess(actor)) return forbidden();

  const limiter = rateLimit(`mobile-notifications:list:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  const params = new URL(request.url).searchParams;
  const parsed = listQuerySchema.safeParse({
    limit: params.get('limit') ?? undefined,
    page: params.get('page') ?? undefined,
    view: params.get('view') ?? undefined,
  });
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_QUERY', message: 'Os parâmetros das notificações não são válidos.' } }, 400);
  }

  try {
    const result = await listNotifications({
      contaId: actor.contaId,
      userId: actor.userId,
      limit: parsed.data.limit,
      page: parsed.data.page,
      view: parsed.data.view as NotificationFeedView,
    });
    return response(serializeNotificationFeed(result));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.mobile.request.failed',
      route: '/api/mobile/notifications',
      method: 'GET',
      requestId: getRequestId(request),
      error,
    });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar as notificações.' } }, 500);
  }
}

export async function PATCH(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();
  if (!hasInboxAccess(actor)) return forbidden();

  const limiter = rateLimit(`mobile-notifications:patch:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);
  }

  const parsed = bulkActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Ação de notificação inválida.' } }, 400);
  }

  try {
    const updatedCount = await markAllNotificationsAsRead({ contaId: actor.contaId, userId: actor.userId });
    return response(notificationBulkActionResponseSchema.parse({ success: true, updatedCount }));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.mobile.request.failed',
      route: '/api/mobile/notifications',
      method: 'PATCH',
      requestId: getRequestId(request),
      error,
    });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível atualizar as notificações.' } }, 500);
  }
}
