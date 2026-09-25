import { NextRequest, NextResponse } from 'next/server';

import { publicSeatReservationSchema } from '@alusa/lib/events/map/event-map.schema';
import { reservePublicEventMapSeats } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';
import { enforcePublicEventMapRateLimit } from '@/src/server/events/public-event-map-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { publicSlug } = await params;
    const limited = await enforcePublicEventMapRateLimit(request, 'reserve', publicSlug);
    if (limited) return limited;
    const body = publicSeatReservationSchema.parse(await request.json());
    return NextResponse.json({ data: await reservePublicEventMapSeats(publicSlug, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_RESERVAR_ASSENTOS_MAPA_PUBLICO');
  }
}
