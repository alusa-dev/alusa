import { NextRequest, NextResponse } from 'next/server';

import { staffSeatReservationSchema } from '@alusa/lib/events/map/event-map.schema';
import { reserveStaffEventMapSeats } from '@alusa/lib/events/map/staff-map-sales.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventTickets.createSale');
    const body = staffSeatReservationSchema.parse(await request.json());
    return NextResponse.json({ data: await reserveStaffEventMapSeats(ctx, eventId, mapId, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_RESERVAR_ASSENTOS_SECRETARIA');
  }
}
