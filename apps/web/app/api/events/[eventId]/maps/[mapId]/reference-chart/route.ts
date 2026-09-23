import { NextRequest, NextResponse } from 'next/server';
import { updateEventMapReferenceChartSchema } from '@alusa/lib/events/map/event-map.schema';
import { getEventMap, updateEventMapReferenceChart } from '@alusa/lib/events/map/event-map.service';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';
import { persistEventMapReferenceFile, removeEventMapReferenceFile, validateReferenceFile } from '@/src/server/media/event-map-reference-storage.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ eventId: string; mapId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  let uploaded: { url: string; storageKey: string | null } | null = null;
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const current = await getEventMap(ctx, eventId, mapId);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) return NextResponse.json({ error: { message: 'Nenhuma planta enviada.' } }, { status: 400 });
    const validationError = validateReferenceFile(file);
    if (validationError) return NextResponse.json({ error: { message: validationError } }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await persistEventMapReferenceFile({ contaId: ctx.contaId, mapId, file, bytes });
    uploaded = asset;
    const level = current.levels[0];
    const scale = level ? Math.min(1, level.widthPx / asset.width, level.heightPx / asset.height) : 1;
    const next = await updateEventMapReferenceChart(ctx, eventId, mapId, {
      referenceChart: {
        ...asset,
        fileName: file.name,
        visible: true,
        opacity: 0.5,
        locked: true,
        transform: {
          x: level ? (level.widthPx - asset.width * scale) / 2 : 0,
          y: level ? (level.heightPx - asset.height * scale) / 2 : 0,
          scale,
          rotation: 0,
        },
        calibration: null,
      },
    });
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
