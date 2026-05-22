import { NextRequest, NextResponse } from 'next/server';

import { updateEventMapDraftSchema } from '@alusa/lib/events/map/event-map.schema';
import { deleteEventMap, getEventMap, updateEventMapDraft } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.view');
    return NextResponse.json({ data: await getEventMap(ctx, eventId, mapId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_OBTER_MAPA_EVENTO');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const body = updateEventMapDraftSchema.parse(await request.json());
    return NextResponse.json({ data: await updateEventMapDraft(ctx, eventId, mapId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_SALVAR_MAPA_EVENTO');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    return NextResponse.json(await deleteEventMap(ctx, eventId, mapId));
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_MAPA_EVENTO');
  }
}
