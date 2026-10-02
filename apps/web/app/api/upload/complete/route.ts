import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { jsonNoStore } from '@/lib/http-security';
import { deleteStorageObject, hashStorageObject, headStorageObject, promotePendingUpload, readStorageObjectPrefix, storageUrlForKey } from '@/lib/r2-storage';
import { detectMimeTypeFromBuffer } from '@/lib/upload-security';
import { completeTenantUpload, getTenantUploadReservation, releaseTenantUpload } from '@/lib/upload-quota.server';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedJson } from '@/lib/upload-request';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const auth = await resolveTenantSession();
  if (!auth.ok) return jsonNoStore({ error: 'Nao autorizado.' }, { status: 401 });
  const rate = await rateLimitAsync(`upload:complete:${auth.contaId}:${auth.userId}:${ipFromRequest(request)}`, 30, 10 * 60_000);
  if (!rate.ok) return jsonNoStore({ error: 'Muitas tentativas.' }, { status: 429 });
  const body = await readBoundedJson<{ reservationId?: unknown }>(request);
  if (!body.ok) return jsonNoStore({ error: body.error }, { status: body.status });
  const payload = body.value;
  if (!payload || typeof payload.reservationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.reservationId)) {
    return jsonNoStore({ error: 'Reserva inválida.' }, { status: 400 });
  }
  const reservation = await getTenantUploadReservation(auth.contaId, payload.reservationId);
  if (!reservation || reservation.status !== 'PENDING' || reservation.expiresAt <= new Date() || !reservation.objectKey.startsWith(`uploads/pending/${auth.contaId}/`)) {
    return jsonNoStore({ error: 'Reserva não encontrada ou expirada.' }, { status: 404 });
  }
  try {
    const head = await headStorageObject(reservation.objectKey);
    const size = Number(head.ContentLength ?? 0);
    const prefix = await readStorageObjectPrefix(reservation.objectKey);
    const detectedMimeType = detectMimeTypeFromBuffer(prefix);
    const valid = size === Number(reservation.expectedSize) && head.Metadata?.['upload-reservation-id'] === reservation.id &&
      Number(head.Metadata?.['expected-size']) === size && head.ContentType === reservation.contentType && detectedMimeType === reservation.contentType;
    if (!valid) {
      let deleted = false;
      try { await deleteStorageObject(reservation.objectKey); deleted = true; } catch { /* cron retries expired pending objects */ }
      if (deleted) await releaseTenantUpload(auth.contaId, reservation.id);
      return jsonNoStore({ error: 'O arquivo enviado não corresponde à reserva.' }, { status: 422 });
    }
    const hashSha256 = await hashStorageObject(reservation.objectKey);
    const finalObjectKey = `uploads/confirmed/${auth.contaId}/${reservation.id}`;
    await promotePendingUpload(reservation.objectKey, finalObjectKey, detectedMimeType);
    const completed = await completeTenantUpload(auth.contaId, reservation.id, size, finalObjectKey);
    if (!completed) {
      await deleteStorageObject(finalObjectKey).catch(() => undefined);
      return jsonNoStore({ error: 'A reserva já foi concluída ou expirou.' }, { status: 409 });
    }
    try { await deleteStorageObject(reservation.objectKey); }
    catch (error) {
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'api.upload.pending_cleanup.failed',
        route: '/api/upload/complete',
        method: 'POST',
        requestId,
        error,
      });
    }
    return jsonNoStore({ url: storageUrlForKey(finalObjectKey), size, type: detectedMimeType, hashSha256 });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.upload.complete.failed',
      route: '/api/upload/complete',
      method: 'POST',
      requestId,
      error,
    });
    return jsonNoStore({ error: 'Não foi possível confirmar o upload.' }, { status: 502 });
  }
}
