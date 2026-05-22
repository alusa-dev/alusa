import { NextRequest, NextResponse } from 'next/server';

import {
  createTicketSale,
  createTicketSaleSchema,
  listByEventQuerySchema,
  listTicketSales,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.view');
    const query = listByEventQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listTicketSales(ctx, { eventId: query.eventId }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_VENDAS_EVENTO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.createSale');
    const body = createTicketSaleSchema.parse(await request.json());
    return NextResponse.json({ data: await createTicketSale(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_VENDA_EVENTO');
  }
}
