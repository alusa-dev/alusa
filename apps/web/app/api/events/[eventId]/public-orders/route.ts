import { NextResponse } from 'next/server';

import { listEventPublicMapOrdersForAdmin } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventTickets.view');
    const data = await listEventPublicMapOrdersForAdmin(ctx.contaId, eventId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_PEDIDOS_PUBLICOS');
  }
}
