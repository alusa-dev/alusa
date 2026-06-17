import { NextRequest, NextResponse } from 'next/server';

import { updateEventMapSettingsSchema } from '@alusa/lib/events/map/event-map.schema';
import { updateEventMapSettings } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventMaps.manage');
    const body = updateEventMapSettingsSchema.parse(await request.json());
    return NextResponse.json({ data: await updateEventMapSettings(ctx, eventId, mapId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_SALVAR_CONFIGURACOES_MAPA');
  }
}
