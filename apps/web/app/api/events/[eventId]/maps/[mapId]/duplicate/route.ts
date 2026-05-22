import { NextRequest, NextResponse } from 'next/server';

import { duplicateEventMapSchema } from '@alusa/lib/events/map/event-map.schema';
import { duplicateEventMap } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const body = duplicateEventMapSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await duplicateEventMap(ctx, eventId, mapId, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DUPLICAR_MAPA_EVENTO');
  }
}
