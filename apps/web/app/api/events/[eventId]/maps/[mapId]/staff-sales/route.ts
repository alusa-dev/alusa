import { NextResponse } from 'next/server';

import { getStaffEventMapSalesView } from '@alusa/lib/events/map/staff-map-sales.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { eventId, mapId } = await params;
    const ctx = await getEventsContext('eventTickets.createSale');
    const holdToken = request.headers.get('x-staff-reservation-token');
    return NextResponse.json({ data: await getStaffEventMapSalesView(ctx, eventId, mapId, holdToken) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CARREGAR_MAPA_VENDA_SECRETARIA');
  }
}
