import { NextRequest, NextResponse } from 'next/server';

import { ticketSaleActionSchema } from '@alusa/lib/events/events.schema';

import { eventPublicOrderRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';
import { getEventOrderRefundContext } from '@/src/server/events/event-route-read.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = eventPublicOrderRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));

    const order = await getEventOrderRefundContext({ orderId, contaId: ctx.contaId });

    if (!order) {
      return NextResponse.json({ error: { code: 'PEDIDO_NAO_ENCONTRADO', message: 'Pedido público não encontrado.' } }, { status: 404 });
    }

    const refundUrl = new URL(
      `/api/cobrancas/${encodeURIComponent(`event-map-order:${order.id}`)}/refund`,
      request.url,
    );
    const response = await fetch(refundUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({
        description: body.reason || `Estorno solicitado via Alusa - pedido público ${order.id}`,
      }),
    });

    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {

    return handleEventsRouteError(error, 'ERRO_ESTORNAR_PEDIDO_PUBLICO_EVENTO');
  }
}
