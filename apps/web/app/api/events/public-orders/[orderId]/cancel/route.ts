import { NextResponse } from 'next/server';

import { eventPublicOrderRouteParamsDTOSchema } from '@/features/events/dtos';
import { cancelPendingPublicOrder } from '@/src/server/events/public-order-cancellation.service';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ orderId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { orderId } = eventPublicOrderRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const result = await cancelPendingPublicOrder({ orderId, contaId: ctx.contaId });

    if (result === 'NOT_FOUND') {
      return NextResponse.json({ error: { code: 'PEDIDO_NAO_ENCONTRADO', message: 'Pedido público não encontrado.' } }, { status: 404 });
    }
    if (result === 'NOT_CANCELLABLE') {
      return NextResponse.json({ error: { code: 'PEDIDO_NAO_CANCELAVEL', message: 'Este pedido não pode ser cancelado.' } }, { status: 409 });
    }
    if (result === 'PROCESSING') {
      return NextResponse.json({ error: { code: 'CANCELAMENTO_EM_PROCESSAMENTO', message: 'O cancelamento está sendo processado. Atualize o pedido em instantes.' } }, { status: 202 });
    }
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CANCELAR_PEDIDO_PUBLICO_EVENTO');
  }
}
