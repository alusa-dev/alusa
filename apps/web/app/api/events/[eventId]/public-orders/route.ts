import { NextResponse } from 'next/server';
import { listEventPublicMapOrdersForAdmin } from '@alusa/lib/events/map/event-map.service';
import { eventPublicOrdersQueryDTOSchema, eventRouteParamsDTOSchema } from '@/features/events/dtos';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    const query = eventPublicOrdersQueryDTOSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const ctx = await getEventsContext('eventTickets.view');
    const data = await listEventPublicMapOrdersForAdmin(ctx.contaId, eventId, query);
    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_PEDIDOS_PUBLICOS');
  }
}
