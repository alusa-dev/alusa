import { randomUUID } from 'crypto';

import { getSessionUser } from '@/lib/auth/session';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import {
  AvatarServiceError,
  prepareAvatarFile,
  removeCurrentAvatar,
  replaceCurrentAvatar,
} from '@/features/account/server/avatar-service';

function errorResponse(error: unknown, correlationId: string) {
  if (error instanceof AvatarServiceError) {
    return jsonNoStore(
      { error: error.message, code: error.code, correlationId },
      { status: error.status },
    );
  }

  console.error('[API /api/users/me/avatar] Erro inesperado.', { correlationId, error });
  return jsonNoStore(
    { error: 'Não foi possível atualizar a foto agora.', correlationId },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

  try {
    const user = await getSessionUser();
    if (!user?.id || !user.contaId) {
      return jsonNoStore({ error: 'Não autorizado.', correlationId }, { status: 401 });
    }

    const limiter = rateLimit(
      `avatar:post:${user.contaId}:${user.id}:${ipFromRequest(request)}`,
      15,
      10 * 60 * 1000,
    );
    if (!limiter.ok) {
      return jsonNoStore(
        { error: 'Muitas tentativas. Aguarde alguns minutos.', correlationId },
        { status: 429 },
      );
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!(file instanceof File)) {
      return jsonNoStore({ error: 'Nenhuma foto foi enviada.', correlationId }, { status: 400 });
    }

    const avatar = await prepareAvatarFile(file);
    const result = await replaceCurrentAvatar(
      { userId: user.id, contaId: user.contaId },
      avatar,
      correlationId,
    );

    return jsonNoStore({ ...result, correlationId });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function DELETE(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

  try {
    const user = await getSessionUser();
    if (!user?.id || !user.contaId) {
      return jsonNoStore({ error: 'Não autorizado.', correlationId }, { status: 401 });
    }

    const limiter = rateLimit(
      `avatar:delete:${user.contaId}:${user.id}:${ipFromRequest(request)}`,
      20,
      10 * 60 * 1000,
    );
    if (!limiter.ok) {
      return jsonNoStore(
        { error: 'Muitas tentativas. Aguarde alguns minutos.', correlationId },
        { status: 429 },
      );
    }

    const result = await removeCurrentAvatar(
      { userId: user.id, contaId: user.contaId },
      correlationId,
    );
    return jsonNoStore({ ...result, correlationId });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
