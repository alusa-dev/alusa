import { NextRequest, NextResponse } from 'next/server';

import { cancelTicketSale, ticketSaleActionSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { saleId: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await cancelTicketSale(ctx, params.saleId, body.reason) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CANCELAR_VENDA_EVENTO');
  }
}
