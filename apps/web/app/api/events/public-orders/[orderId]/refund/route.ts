import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@alusa/database';
import { ticketSaleActionSchema } from '@alusa/lib/events/events.schema';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = await params;
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));

    const order = await prisma.eventMapOrder.findFirst({
      where: { id: orderId, contaId: ctx.contaId },
      select: {
        id: true,
        eventId: true,
        asaasPaymentId: true,
        buyerName: true,
        buyerEmail: true,
        status: true,
        paymentStatus: true,
      },
    });

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
