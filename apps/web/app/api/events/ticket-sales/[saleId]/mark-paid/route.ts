import { NextResponse } from 'next/server';

import { markTicketSalePaid } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { saleId: string } };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.markPaid');
    return NextResponse.json({ data: await markTicketSalePaid(ctx, params.saleId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_MARCAR_VENDA_PAGA');
  }
}
