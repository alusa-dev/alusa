import { NextRequest, NextResponse } from 'next/server';

import {
  createTicketLot,
  createTicketLotSchema,
  listByEventQuerySchema,
  listTicketLots,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.view');
    const query = listByEventQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listTicketLots(ctx, { eventId: query.eventId }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_LOTES_EVENTO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.manageLots');
    const body = createTicketLotSchema.parse(await request.json());
    return NextResponse.json({ data: await createTicketLot(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_LOTE_EVENTO');
  }
}
