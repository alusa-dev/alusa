import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import { deleteNotificationRecipient, updateNotificationRecipientState } from '@alusa/lib';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({
  action: z.enum(['read', 'unread', 'archive', 'unarchive']),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para atualizar notificações.' });
    }

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
      return json(422, {
        error: 'PARAMETROS_INVALIDOS',
        message: 'Identificador de notificação inválido.',
        details: params.error.flatten(),
      });
    }

    const body = bodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return json(422, {
        error: 'PAYLOAD_INVALIDO',
        message: 'Payload inválido para atualização da notificação.',
        details: body.error.flatten(),
      });
    }

    const updated = await updateNotificationRecipientState({
      contaId: user.contaId,
      userId: user.id,
      notificationId: params.data.id,
      action: body.data.action,
    });

    if (!updated) {
      return json(404, { error: 'NOTIFICACAO_NAO_ENCONTRADA', message: 'Notificação não encontrada.' });
    }

    return json(200, { success: true });
  } catch (error) {
    console.error('[Notifications][Item][PATCH]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível atualizar a notificação.' });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Usuário sem permissão para excluir notificações.' });
    }

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
      return json(422, {
        error: 'PARAMETROS_INVALIDOS',
        message: 'Identificador de notificação inválido.',
        details: params.error.flatten(),
      });
    }

    const deleted = await deleteNotificationRecipient({
      contaId: user.contaId,
      userId: user.id,
      notificationId: params.data.id,
    });

    if (!deleted) {
      return json(404, { error: 'NOTIFICACAO_NAO_ENCONTRADA', message: 'Notificação não encontrada.' });
    }

    return json(200, { success: true });
  } catch (error) {
    console.error('[Notifications][Item][DELETE]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível excluir a notificação.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
