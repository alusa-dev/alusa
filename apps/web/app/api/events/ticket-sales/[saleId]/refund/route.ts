import { NextRequest, NextResponse } from 'next/server';

import { refundTicketSale, ticketSaleActionSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { saleId: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await refundTicketSale(ctx, params.saleId, body.reason) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ESTORNAR_VENDA_EVENTO');
  }
}
