import { NextRequest, NextResponse } from 'next/server';

import { deleteTicketSale, updateTicketSale, updateTicketSaleSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ saleId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const body = updateTicketSaleSchema.parse(await request.json());
    const ctx = await getEventsContext('eventTickets.createSale');
    return NextResponse.json({ data: await updateTicketSale(ctx, resolvedParams.saleId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_VENDA_EVENTO');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const ctx = await getEventsContext('eventTickets.cancelSale');
    return NextResponse.json({ data: await deleteTicketSale(ctx, resolvedParams.saleId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_VENDA_EVENTO');
  }
}
