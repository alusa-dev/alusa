import { NextRequest, NextResponse } from 'next/server';

import { publishEventMapSchema, updateEventMapDraftSchema } from '@alusa/lib/events/map/event-map.schema';
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
    const body: unknown = await request.json().catch(() => null);
    let expectedUpdatedAt: string;
    const isDraftPayload = typeof body === 'object' && body !== null && (
      'levels' in body || 'sections' in body || 'objects' in body || 'seats' in body || 'document' in body || 'name' in body
    );
    if (isDraftPayload) {
      const draft = updateEventMapDraftSchema.parse(body);
      const saved = await updateEventMapDraft(ctx, eventId, mapId, draft);
      expectedUpdatedAt = saved.updatedAt;
    } else {
      expectedUpdatedAt = publishEventMapSchema.parse(body).expectedUpdatedAt;
    }
    return NextResponse.json({ data: await publishEventMap(ctx, eventId, mapId, expectedUpdatedAt) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_PUBLICAR_MAPA_EVENTO');
  }
}
