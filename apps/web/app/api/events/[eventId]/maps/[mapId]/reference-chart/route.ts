import { NextRequest, NextResponse } from 'next/server';
import { updateEventMapReferenceChartSchema } from '@alusa/lib/events/map/event-map.schema';
import { getEventMap, updateEventMapReferenceChart } from '@alusa/lib/events/map/event-map.service';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';
import { persistEventMapReferenceFile, removeEventMapReferenceFile, validateReferenceFile } from '@/src/server/media/event-map-reference-storage.service';
import { readBoundedFormData } from '@/lib/upload-request';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import { validateUploadBuffer } from '@/lib/upload-security';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ eventId: string; mapId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  let uploaded: { url: string; storageKey: string | null } | null = null;
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const rate = await rateLimitAsync(`event-reference-upload:${ctx.contaId}:${ctx.userId}`, 10, 10 * 60_000);
    if (!rate.ok) return NextResponse.json({ error: { message: 'Muitas tentativas.' } }, { status: 429 });
    const current = await getEventMap(ctx, eventId, mapId);
    const uploadBody = await readBoundedFormData(request);
    if (!uploadBody.ok) return NextResponse.json({ error: { message: uploadBody.error } }, { status: uploadBody.status });
    const formData = uploadBody.formData;
    const file = formData.get('file');
    if (!file || !(file instanceof File)) return NextResponse.json({ error: { message: 'Nenhuma planta enviada.' } }, { status: 400 });
    const validationError = validateReferenceFile(file);
    if (validationError) return NextResponse.json({ error: { message: validationError } }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const binary = validateUploadBuffer({ buffer: bytes, fileName: file.name, declaredMimeType: file.type, fileSize: file.size, maxSizeBytes: 3 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'] });
    if (!binary.ok) return NextResponse.json({ error: { message: binary.error } }, { status: 400 });
    const quota = await withTenantUploadQuota({
      contaId: ctx.contaId,
      fileSize: file.size,
      contentType: file.type,
      objectKey: `uploads/event-map-reservations/${ctx.contaId}/${randomUUID()}`,
      cleanup: async () => { if (uploaded) await removeEventMapReferenceFile(uploaded); },
      action: async () => {
        const asset = await persistEventMapReferenceFile({ contaId: ctx.contaId, mapId, file, bytes });
        uploaded = asset;
        return asset;
      },
    });
    if (!quota.ok) return NextResponse.json({ error: { code: 'UPLOAD_QUOTA_EXCEEDED' } }, { status: 413 });
    uploaded = quota.result;
    const asset = quota.result;
    const level = current.levels[0];
    const scale = level ? Math.min(1, level.widthPx / asset.width, level.heightPx / asset.height) : 1;
    const next = await updateEventMapReferenceChart(ctx, eventId, mapId, {
      referenceChart: {
        ...asset, fileName: file.name, visible: true, opacity: 0.5, locked: true,
        transform: { x: level ? (level.widthPx - asset.width * scale) / 2 : 0, y: level ? (level.heightPx - asset.height * scale) / 2 : 0, scale, rotation: 0 },
        calibration: null,
      },
    });
    uploaded = null;
    await removeEventMapReferenceFile(current.referenceChart);
    return NextResponse.json({ data: next });
  } catch (error) {
    if (uploaded) await removeEventMapReferenceFile(uploaded);
    return handleEventsRouteError(error, 'ERRO_ENVIAR_PLANTA_REFERENCIA');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const rate = await rateLimitAsync(`event-reference-upload:${ctx.contaId}:${ctx.userId}`, 10, 10 * 60_000);
    if (!rate.ok) return NextResponse.json({ error: { message: 'Muitas tentativas.' } }, { status: 429 });
    const current = await getEventMap(ctx, eventId, mapId);
    const payload = updateEventMapReferenceChartSchema.parse(await request.json());
    const next = await updateEventMapReferenceChart(ctx, eventId, mapId, payload);
    if (payload.referenceChart === null || payload.referenceChart.storageKey !== current.referenceChart?.storageKey) {
      await removeEventMapReferenceFile(current.referenceChart);
    }
    return NextResponse.json({ data: next });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_PLANTA_REFERENCIA');
  }
}
