import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextRequest, NextResponse } from 'next/server';
import {
  listNotifications,
  markAllNotificationsAsRead,
  type NotificationFeedView,
} from '@alusa/lib/services/notifications.service';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { notificationBulkActionResponseSchema, notificationBulkActionSchema, notificationListQuerySchema, serializeNotificationFeed } from '@alusa/lib/notifications/inbox-contract';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const listQuerySchema = notificationListQuerySchema(100);
const bulkActionSchema = notificationBulkActionSchema;
function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  const timer = createPerfTimer('api/notifications');
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    const user = { id: auth.userId, contaId: auth.contaId, role: auth.role };
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

    const body = serializeNotificationFeed(result);
    timer.end('GET /notifications (database read)');
    return json(200, body);
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.notifications.request.failed',
      route: '/api/notifications',
      method: 'GET',
      requestId: getRequestId(req),
      error,
    });
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível carregar as notificações.' });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    const user = { id: auth.userId, contaId: auth.contaId, role: auth.role };
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

    return json(200, notificationBulkActionResponseSchema.parse({ success: true, updatedCount }));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.notifications.request.failed',
      route: '/api/notifications',
      method: 'PATCH',
      requestId: getRequestId(req),
      error,
    });
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível atualizar as notificações.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
