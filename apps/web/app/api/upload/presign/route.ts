import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { createPresignedUpload, deleteStorageObject, isR2Configured } from '@/lib/r2-storage';
import { expireTenantUploadReservations, reserveTenantUpload, releaseTenantUpload } from '@/lib/upload-quota.server';
import { readBoundedJson } from '@/lib/upload-request';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const URL_TTL_SECONDS = 60;

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const auth = await resolveTenantSession();
  if (!auth.ok) return jsonNoStore({ error: 'Nao autorizado.' }, { status: 401 });
  if (!isR2Configured()) return jsonNoStore({ error: 'Armazenamento direto indisponível.' }, { status: 503 });
  if (process.env.R2_PRESIGNED_UPLOADS_ENABLED !== 'true') {
    return jsonNoStore({ error: 'Upload direto de arquivos grandes ainda não está habilitado nesta implantação. Use o fluxo padrão para arquivos até 3 MiB.' }, { status: 503 });
  }
  const limit = await rateLimitAsync(`upload:presign:${auth.contaId}:${auth.userId}:${ipFromRequest(request)}`, 10, 10 * 60_000);
  if (!limit.ok) return jsonNoStore({ error: 'Muitas tentativas.' }, { status: 429 });
  const parsed = await readBoundedJson<{ size?: unknown; contentType?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) return jsonNoStore({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (typeof body.size !== 'number' || !Number.isSafeInteger(body.size) || body.size < 1 || body.size > MAX_FILE_BYTES ||
      typeof body.contentType !== 'string' || !TYPES.has(body.contentType)) {
    return jsonNoStore({ error: 'Arquivo ou tamanho inválido.' }, { status: 400 });
  }

  const expiredKeys = await expireTenantUploadReservations(auth.contaId);
  const orphanCleanup = await Promise.allSettled(expiredKeys.map((key) => deleteStorageObject(key)));
  const failedOrphanCleanupCount = orphanCleanup.filter((result) => result.status === 'rejected').length;
  if (failedOrphanCleanupCount > 0) {
    logApiOperationalEvent({
      severity: 'warn',
      eventName: 'api.upload.orphan_cleanup.failed',
      route: '/api/upload/presign',
      method: 'POST',
      requestId,
      itemCount: failedOrphanCleanupCount,
    });
  }
  const reserved = await reserveTenantUpload(auth.contaId, body.size, body.contentType, undefined, auth.userId);
  if (!reserved.ok) return jsonNoStore({ error: 'Limite diário de upload da conta excedido.' }, { status: 413 });
  const reservation = reserved.reservation;
  try {
    const uploadUrl = await createPresignedUpload({
      key: reservation.objectKey,
      contentType: body.contentType,
      reservationId: reservation.id,
      expectedSize: body.size,
      expiresInSeconds: Math.min(reserved.expiresInSeconds, URL_TTL_SECONDS),
    });
    return jsonNoStore({
      uploadUrl,
      reservationId: reservation.id,
      expiresInSeconds: URL_TTL_SECONDS,
      requiredHeaders: {
        'Content-Type': body.contentType,
        'x-amz-meta-upload-reservation-id': reservation.id,
        'x-amz-meta-expected-size': String(body.size),
      },
      expectedContentLength: body.size,
    });
  } catch (error) {
    await releaseTenantUpload(auth.contaId, reservation.id);
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.upload.presign.failed',
      route: '/api/upload/presign',
      method: 'POST',
      requestId,
      error,
    });
    return jsonNoStore({ error: 'Não foi possível preparar o upload.' }, { status: 503 });
  }
}
