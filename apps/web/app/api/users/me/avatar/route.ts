import { randomUUID } from 'crypto';

import { getSessionUser } from '@/lib/auth/session';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedFormData } from '@/lib/upload-request';
import {
  AvatarServiceError,
  prepareAvatarFile,
  removeCurrentAvatar,
  replaceCurrentAvatar,
} from '@/features/account/server/avatar-service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

function errorResponse(error: unknown, correlationId: string, requestId: string, method: 'POST' | 'DELETE') {
  if (error instanceof AvatarServiceError) {
    return jsonNoStore(
      { error: error.message, code: error.code, correlationId },
      { status: error.status },
    );
  }

  logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/me/avatar', method, requestId, error });
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

    const limiter = await rateLimitAsync(
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

    const parsedBody = await readBoundedFormData(request);
    if (!parsedBody.ok) return jsonNoStore({ error: parsedBody.error, correlationId }, { status: parsedBody.status });
    const file = parsedBody.formData.get('file');
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
    return errorResponse(error, correlationId, getRequestId(request), 'POST');
  }
}

export async function DELETE(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

  try {
    const user = await getSessionUser();
    if (!user?.id || !user.contaId) {
      return jsonNoStore({ error: 'Não autorizado.', correlationId }, { status: 401 });
    }

    const limiter = await rateLimitAsync(
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
    return errorResponse(error, correlationId, getRequestId(request), 'DELETE');
  }
}
