import { deleteNotificationRecipient, updateNotificationRecipientState } from '@alusa/lib';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const paramsSchema = z.object({ id: z.string().trim().min(1).max(191) });
const bodySchema = z.object({ action: z.enum(['read', 'unread', 'archive', 'unarchive']) }).strict();

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

function unauthorized() {
  return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
}

function forbidden() {
  return response({ error: { code: 'FORBIDDEN', message: 'Usuário sem permissão para atualizar notificações.' } }, 403);
}

async function resolveId(context: { params: Promise<{ id: string }> }) {
  const parsed = paramsSchema.safeParse(await context.params);
  return parsed.success ? parsed.data.id : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();
  if (!allowedRoles.has(actor.role.toUpperCase())) return forbidden();

  const limiter = rateLimit(`mobile-notifications:item:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);
  }

  const notificationId = await resolveId(context);
  if (!notificationId) return response({ error: { code: 'INVALID_INPUT', message: 'Identificador inválido.' } }, 400);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: 'Ação de notificação inválida.' } }, 400);

  try {
    const updated = await updateNotificationRecipientState({
      contaId: actor.contaId,
      userId: actor.userId,
      notificationId,
      action: parsed.data.action,
    });
    if (!updated) return response({ error: { code: 'NOT_FOUND', message: 'Notificação não encontrada.' } }, 404);
    return response({ success: true });
  } catch (error) {
    console.error('[api/mobile/notifications][PATCH item]', error instanceof Error ? error.message : String(error));
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível atualizar a notificação.' } }, 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();
  if (!allowedRoles.has(actor.role.toUpperCase())) return forbidden();

  const limiter = rateLimit(`mobile-notifications:delete:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);
  }

  const notificationId = await resolveId(context);
  if (!notificationId) return response({ error: { code: 'INVALID_INPUT', message: 'Identificador inválido.' } }, 400);

  try {
    const deleted = await deleteNotificationRecipient({
      contaId: actor.contaId,
      userId: actor.userId,
      notificationId,
    });
    if (!deleted) return response({ error: { code: 'NOT_FOUND', message: 'Notificação não encontrada.' } }, 404);
    return response({ success: true });
  } catch (error) {
    console.error('[api/mobile/notifications][DELETE]', error instanceof Error ? error.message : String(error));
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível excluir a notificação.' } }, 500);
  }
}
