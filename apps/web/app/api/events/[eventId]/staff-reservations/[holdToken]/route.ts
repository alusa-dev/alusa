import { NextRequest, NextResponse } from 'next/server';

import { staffSeatReservationSchema } from '@alusa/lib/events/map/event-map.schema';
import { releaseStaffEventMapReservation, reserveStaffEventMapSeats } from '@alusa/lib/events/map/staff-map-sales.service';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; holdToken: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, holdToken } = await params;
    const ctx = await getEventsContext('eventTickets.createSale');
    const body = staffSeatReservationSchema.parse(await request.json());
    const mapId = new URL(request.url).searchParams.get('mapId');
    if (!mapId) {
      return NextResponse.json({ error: 'Informe o mapId na query string.' }, { status: 422 });
    }
    return NextResponse.json({
      data: await reserveStaffEventMapSeats(ctx, eventId, mapId, { ...body, holdToken }),
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_RESERVA_SECRETARIA');
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { eventId, holdToken } = await params;
    const ctx = await getEventsContext('eventTickets.createSale');
    return NextResponse.json({ data: await releaseStaffEventMapReservation(ctx, eventId, holdToken) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LIBERAR_RESERVA_SECRETARIA');
  }
}
