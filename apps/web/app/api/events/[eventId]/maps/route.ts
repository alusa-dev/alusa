import { NextRequest, NextResponse } from 'next/server';

import { createEventMapSchema } from '@alusa/lib/events/map/event-map.schema';
import { createEventMap, listEventMaps } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventMaps.view');
    return NextResponse.json({ data: await listEventMaps(ctx, eventId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_MAPAS_EVENTO');
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const body = createEventMapSchema.parse(await request.json());
    return NextResponse.json({ data: await createEventMap(ctx, eventId, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_MAPA_EVENTO');
  }
}
