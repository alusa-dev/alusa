import { NextRequest, NextResponse } from 'next/server';

import { ticketSaleActionSchema } from '@alusa/lib/events/events.schema';

import { eventPublicOrderRouteParamsDTOSchema } from '@/features/events/dtos';
import { executeCobrancaRefund } from '@/src/server/finance/refund-charge.service';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';
import { getEventOrderRefundContext } from '@/src/server/events/event-route-read.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = eventPublicOrderRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('eventTickets.refund');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));

    const order = await getEventOrderRefundContext({ orderId, contaId: ctx.contaId });

    if (!order) {
      return NextResponse.json({ error: { code: 'PEDIDO_NAO_ENCONTRADO', message: 'Pedido público não encontrado.' } }, { status: 404 });
    }

    const result = await executeCobrancaRefund({
      contaId: ctx.contaId,
      userId: ctx.userId,
      role: ctx.role,
      id: `event-map-order:${order.id}`,
      body: {
        description: body.reason || `Estorno solicitado via Alusa - pedido público ${order.id}`,
      },
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {

    return handleEventsRouteError(error, 'ERRO_ESTORNAR_PEDIDO_PUBLICO_EVENTO');
  }
}
