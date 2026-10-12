import { NextResponse } from 'next/server';

import { requestEventTicketSaleWhatsAppResend } from '@alusa/finance';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ saleId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { saleId } = await params;
    const ctx = await getEventsContext('eventTickets.markPaid');
    const data = await requestEventTicketSaleWhatsAppResend(ctx, saleId);
    return NextResponse.json({ data }, { status: data.queued ? 202 : 200 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REENVIAR_WHATSAPP_INGRESSOS');
  }
}
