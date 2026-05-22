import { NextRequest, NextResponse } from 'next/server';

import { publishEventMap } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.publish');
    return NextResponse.json({ data: await publishEventMap(ctx, eventId, mapId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_PUBLICAR_MAPA_EVENTO');
  }
}
