import { NextRequest, NextResponse } from 'next/server';

import { deleteTicketLot, updateTicketLot, updateTicketLotSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ lotId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { lotId } = await params;
    const ctx = await getEventsContext('eventTickets.manageLots');
    const body = updateTicketLotSchema.parse(await request.json());
    return NextResponse.json({ data: await updateTicketLot(ctx, lotId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_LOTE_EVENTO');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { lotId } = await params;
    const ctx = await getEventsContext('eventTickets.manageLots');
    return NextResponse.json({ data: await deleteTicketLot(ctx, lotId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_LOTE_EVENTO');
  }
}
