import { NextRequest, NextResponse } from 'next/server';

import { updateEventMapDraftSchema } from '@alusa/lib/events/map/event-map.schema';
import { publishEventMap, updateEventMapDraft } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.publish');
    const body = await request.json().catch(() => null);
    if (body) {
      const draft = updateEventMapDraftSchema.parse(body);
      await updateEventMapDraft(ctx, eventId, mapId, draft);
    }
    return NextResponse.json({ data: await publishEventMap(ctx, eventId, mapId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_PUBLICAR_MAPA_EVENTO');
  }
}
