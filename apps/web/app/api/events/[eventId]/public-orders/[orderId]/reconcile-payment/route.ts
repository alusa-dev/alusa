import { NextResponse } from 'next/server';

import { reconcileEventMapOrderPayment } from '@alusa/lib/events/map/reconcile-event-map-order-payment';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; orderId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { eventId, orderId } = await params;
    const ctx = await getEventsContext('eventFinance.reconcile');
    const result = await reconcileEventMapOrderPayment({
      contaId: ctx.contaId,
      userId: ctx.userId,
      eventId,
      orderId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_RECONCILIAR_PEDIDO_PUBLICO');
  }
}
