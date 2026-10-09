import { NextRequest, NextResponse } from 'next/server';

import { getPublicEventMap } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { publicSlug } = await params;
    return noStore(NextResponse.json({ data: await getPublicEventMap(publicSlug) }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_OBTER_MAPA_PUBLICO'));
  }
}
