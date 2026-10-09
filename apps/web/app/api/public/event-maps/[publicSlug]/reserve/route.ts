import { NextRequest, NextResponse } from 'next/server';

import { publicSeatReservationSchema } from '@alusa/lib/events/map/event-map.schema';
import { reservePublicEventMapSeats } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';
import { enforcePublicEventMapRateLimit } from '@/src/server/events/public-event-map-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { publicSlug } = await params;
    const limited = await enforcePublicEventMapRateLimit(request, 'reserve');
    if (limited) return noStore(limited);
    const body = publicSeatReservationSchema.parse(await request.json());
    return noStore(NextResponse.json({ data: await reservePublicEventMapSeats(publicSlug, body) }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_RESERVAR_ASSENTOS_MAPA_PUBLICO'));
  }
}
